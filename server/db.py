"""Supabase access for the ArrangerBox AI server.

Needs SUPABASE_URL and SUPABASE_SECRET_KEY (Modal secret "arrangerbox-ai"). The secret key
bypasses row level security, so it stays on the server; the app only reads its own rows.

    verify_user(authorization)  -> user id from a Supabase access token (ES256, JWKS)
    get_job / insert_job / update_job / delete_job / expired_jobs
    jobs_today(user_id)         -> jobs started in the last 24 h (append-only ai_usage)
"""

import os
from datetime import datetime, timezone
from functools import lru_cache

import httpx


def _url() -> str:
    return os.environ["SUPABASE_URL"].rstrip("/")


def _headers(**extra: str) -> dict:
    key = os.environ["SUPABASE_SECRET_KEY"]
    h = {"apikey": key, "Content-Type": "application/json", **extra}
    if key.startswith("eyJ"):  # legacy service_role JWT also goes in Authorization
        h["Authorization"] = f"Bearer {key}"
    return h


@lru_cache(maxsize=1)
def _client() -> httpx.Client:
    return httpx.Client(timeout=15)


def _rest(method: str, path: str, **kw) -> httpx.Response:
    r = _client().request(method, f"{_url()}/rest/v1/{path}", **kw)
    r.raise_for_status()
    return r


# ---- auth -----------------------------------------------------------------


@lru_cache(maxsize=1)
def _jwks():
    import jwt

    return jwt.PyJWKClient(f"{_url()}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)


def verify_user(authorization: str | None) -> str | None:
    """Returns the user id for a valid Supabase access token, else None."""
    import jwt

    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:].strip()
    try:
        key = _jwks().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["ES256", "RS256", "EdDSA"],
            audience="authenticated",
            issuer=f"{_url()}/auth/v1",
        )
    except Exception as exc:  # expired, wrong signature, unknown key ...
        print("auth rejected:", type(exc).__name__, exc)
        return None
    if claims.get("role") != "authenticated" or not claims.get("sub"):
        return None
    return claims["sub"]


# ---- jobs -----------------------------------------------------------------


def _ts(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()


def to_api(row: dict) -> dict:
    """Row -> the job shape the app expects (epoch seconds, no server paths)."""
    out = {k: v for k, v in row.items() if k not in ("input_path", "user_id", "created_at", "updated_at")}
    out["created"] = _ts(row["created_at"])
    out["updated"] = _ts(row["updated_at"])
    if out.get("result") is None:
        out.pop("result", None)
    return out


def get_job(job_id: str) -> dict | None:
    rows = _rest("GET", "ai_jobs", params={"id": f"eq.{job_id}", "select": "*"}, headers=_headers()).json()
    return rows[0] if rows else None


def insert_job(row: dict) -> None:
    _rest("POST", "ai_jobs", json=row, headers=_headers(Prefer="return=minimal"))
    _rest(
        "POST",
        "ai_usage",
        json={"user_id": row["user_id"], "job_id": row["id"], "kind": row["kind"], "bytes": row.get("bytes", 0)},
        headers=_headers(Prefer="return=minimal"),
    )


def update_job(job_id: str, **fields) -> None:
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    _rest("PATCH", "ai_jobs", params={"id": f"eq.{job_id}"}, json=fields, headers=_headers(Prefer="return=minimal"))


def delete_job(job_id: str) -> None:
    _rest("DELETE", "ai_jobs", params={"id": f"eq.{job_id}"}, headers=_headers(Prefer="return=minimal"))


def expired_jobs(older_than_s: float) -> list[str]:
    cutoff = datetime.fromtimestamp(datetime.now(timezone.utc).timestamp() - older_than_s, timezone.utc).isoformat()
    rows = _rest("GET", "ai_jobs", params={"created_at": f"lt.{cutoff}", "select": "id"}, headers=_headers()).json()
    return [r["id"] for r in rows]


def all_job_ids() -> set[str]:
    rows = _rest("GET", "ai_jobs", params={"select": "id"}, headers=_headers()).json()
    return {r["id"] for r in rows}


def jobs_today(user_id: str, notes: bool = False) -> int:
    """Jobs in the last 24 hours: note searches (notes=True) or everything else."""
    cutoff = datetime.fromtimestamp(datetime.now(timezone.utc).timestamp() - 86400, timezone.utc).isoformat()
    r = _rest(
        "HEAD",
        "ai_usage",
        params={"user_id": f"eq.{user_id}", "created_at": f"gte.{cutoff}", "kind": "eq.notes" if notes else "neq.notes", "select": "id"},
        headers=_headers(Prefer="count=exact"),
    )
    return int(r.headers.get("content-range", "*/0").split("/")[-1] or 0)
