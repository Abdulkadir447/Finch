import os
from datetime import timedelta
from fastapi import Depends, HTTPException, status
from functools import wraps
from jose import JWTError, jwt
from pydantic import BaseModel

# JWT settings
SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-change-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Simple user model
class TokenData(BaseModel):
    username: str | None = None

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token: str) -> TokenData:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
        return TokenData(username=username)
    except JWTError:
        raise credentials_exception

def get_current_user(access_token: str = Depends(oauth2_scheme)) -> TokenData:
    return verify_token(access_token)

# Dependency for OAuth2 scheme (placeholder for actual oauth2 scheme)
def oauth2_scheme(token: str = Depends()):
    return token

# Simple JWT decorator
def jwt_required(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        token = await get_current_user()
        request.state.user = token.username
        return await func(*args, **kwargs)
    return wrapper