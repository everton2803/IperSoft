from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse
from app.routers.auth import get_current_user
from app.utils.security import hash_password

router = APIRouter(prefix="/users", tags=["Gestão de Usuários"])

def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito: apenas administradores podem gerenciar usuários."
        )
    return current_user


@router.get("", response_model=List[UserResponse])
def list_users(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    users = db.query(User).order_by(User.id.asc()).all()
    return users


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: UserCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    # Verificar se username já existe
    existing_username = db.query(User).filter(User.username.ilike(user_in.username)).first()
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este nome de usuário já está cadastrado."
        )

    # Verificar se e-mail já existe
    existing_email = db.query(User).filter(User.email.ilike(user_in.email)).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este e-mail já está cadastrado no sistema."
        )

    # Criar usuário
    new_user = User(
        username=user_in.username.strip(),
        email=user_in.email.strip().lower(),
        full_name=user_in.full_name.strip(),
        hashed_password=hash_password(user_in.password),
        role=user_in.role or "noc_operator",
        is_active=True
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    if admin.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Você não pode excluir a sua própria conta de administrador."
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuário não encontrado."
        )

    db.delete(user)
    db.commit()
    return None
