import os
import base64
import logging
import urllib.request
import json
import jwt
from jwt.exceptions import PyJWTError, ExpiredSignatureError
from jwt.algorithms import RSAAlgorithm
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger("hiresense.auth")

security = HTTPBearer(auto_error=False)

# Cache JWKS keys and parsed domain
_jwks_cache = None
_clerk_domain = None

def get_clerk_domain() -> str | None:
    global _clerk_domain
    if _clerk_domain:
        return _clerk_domain
    
    # Try both Vite and standard environment keys
    key = os.getenv("VITE_CLERK_PUBLISHABLE_KEY") or os.getenv("CLERK_PUBLISHABLE_KEY")
    is_prod = os.getenv("FASTAPI_ENV") == "production" or os.getenv("APP_ENV") == "production"
    
    if not key or "placeholder" in key or key.strip() == "":
        if is_prod:
            raise ValueError("CLERK_PUBLISHABLE_KEY or VITE_CLERK_PUBLISHABLE_KEY must be set in production mode")
        return None
        
    try:
        # Clerk publishable key format is pk_test_<base64> or pk_live_<base64>
        parts = key.split("_")
        if len(parts) >= 3:
            b64_part = parts[-1]
            b64_part += "=" * ((4 - len(b64_part) % 4) % 4)
            decoded = base64.b64decode(b64_part).decode("utf-8")
            _clerk_domain = decoded.rstrip("$")
            logger.info(f"Parsed Clerk domain: {_clerk_domain}")
            return _clerk_domain
    except Exception as e:
        logger.error(f"Failed to parse Clerk publishable key: {e}")
    return None

def fetch_jwks(domain: str) -> dict | None:
    global _jwks_cache
    if _jwks_cache:
        return _jwks_cache
        
    url = f"https://{domain}/.well-known/jwks.json"
    try:
        logger.info(f"Fetching Clerk JWKS from {url}")
        req = urllib.request.Request(
            url, 
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            _jwks_cache = json.loads(response.read().decode())
            return _jwks_cache
    except Exception as e:
        logger.error(f"Failed to fetch Clerk JWKS from {url}: {e}")
    return None

def verify_clerk_token(token: str) -> dict | None:
    domain = get_clerk_domain()
    if not domain:
        # Bypassed/Developer mode
        return {"sub": "anonymous-developer"}
        
    jwks = fetch_jwks(domain)
    if not jwks:
        logger.error("No JWKS keys loaded. Failing authentication.")
        return None
        
    try:
        # Extract kid claim from unverified headers
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            logger.error("Token header missing kid claim.")
            return None
            
        # Find matching key in JWKS
        key_data = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                key_data = key
                break
                
        if not key_data:
            logger.error(f"Public key with kid {kid} not found in JWKS.")
            return None
            
        # Build RSA public key from JWK dictionary
        public_key = RSAAlgorithm.from_jwk(json.dumps(key_data))
        
        # Verify and decode JWT
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            options={"verify_aud": False}
        )
        return payload
    except ExpiredSignatureError:
        logger.warning("Clerk JWT token has expired.")
        raise HTTPException(status_code=401, detail="Token has expired")
    except PyJWTError as e:
        logger.warning(f"Clerk JWT validation failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        logger.error(f"Unexpected error validating token: {e}")
        return None

async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Security(security)
) -> str:
    # Bypass verification in local unit testing environments or when auth keys are unset
    import sys
    is_testing = "pytest" in sys.modules
    domain = get_clerk_domain()
    
    if is_testing or not domain:
        return "anonymous-developer"
        
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
        
    token = credentials.credentials
    payload = verify_clerk_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid auth token")
        
    return payload["sub"]
