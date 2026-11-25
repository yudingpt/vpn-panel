"""Тексты сообщений и подписи кнопок бота: стандартные значения и свои.

Свои тексты хранятся в bot_config.bot_texts, подписи кнопок — в menu_labels
(их сохраняют вместе с остальными настройками меню), фото отдельных
сообщений — в bot_config.message_photos. Здесь отдаётся реестр (стандартные
значения, подстановки, примеры для превью, ссылка на фото) и сохраняются
тексты/фото.
"""

from fastapi import APIRouter, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from shared import bus
from shared.botcopy import (
    BUTTONS,
    MESSAGES,
    PLAIN_ICONS,
    Copy,
    CopyError,
    validate_message,
)

from app.api.deps import CurrentAdmin, DbSession
from app.api.v1.bot import (
    _audit,
    _config,
    _drop_photo_file,
    _save_photo,
)
from app.core.config import settings

router = APIRouter(prefix="/bot/texts", tags=["bot-texts"])


class VarOut(BaseModel):
    name: str
    hint: str
    example: str


class CopyOut(BaseModel):
    key: str
    default: str
    title: str
    where: str
    variables: list[VarOut]
    # Своё значение; None — используется стандартное.
    value: str | None = None
    # Ссылка на своё фото сообщения; None — картинка меню.
    photo_url: str | None = None


class TextsOut(BaseModel):
    messages: list[CopyOut]
    buttons: list[CopyOut]
    icons: dict[str, str]


def _photo_url(name: str | None) -> str | None:
    return f"{settings.public_url}/uploads/{name}" if name else None


def _out(item: Copy, custom: dict[str, str], photo: str | None = None) -> CopyOut:
    return CopyOut(
        key=item.key,
        default=item.default,
        title=item.title,
        where=item.where,
        variables=[
            VarOut(name=v.name, hint=v.hint, example=v.example) for v in item.variables
        ],
        value=custom.get(item.key),
        photo_url=_photo_url(photo),
    )


def _all(row) -> TextsOut:
    texts = dict(row.bot_texts or {})
    labels = dict(row.menu_labels or {})
    photos = dict(row.message_photos or {})
    return TextsOut(
        messages=[_out(m, texts, photos.get(m.key)) for m in MESSAGES],
        buttons=[_out(b, labels) for b in BUTTONS],
        icons=PLAIN_ICONS,
    )


def _check_key(key: str) -> None:
    if key not in {m.key for m in MESSAGES}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Неизвестное сообщение")


@router.get("", response_model=TextsOut)
async def get_texts(admin: CurrentAdmin, db: DbSession) -> TextsOut:
    return _all(await _config(db))


class TextsIn(BaseModel):
    # Все свои тексты целиком: чего нет в словаре или пусто — стандартный.
    values: dict[str, str] = Field(default_factory=dict, max_length=64)


@router.put("", response_model=TextsOut)
async def save_texts(
    data: TextsIn, admin: CurrentAdmin, db: DbSession, request: Request
) -> TextsOut:
    clean: dict[str, str] = {}
    for key, text in data.values.items():
        try:
            checked = validate_message(key, text or "")
        except CopyError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
        if checked is not None:
            clean[key] = checked
    row = await _config(db)
    row.bot_texts = clean
    _audit(db, admin, "bot.texts", request, changed=sorted(clean))
    await db.flush()
    await db.commit()  # видно боту ДО pub/sub-уведомления
    await bus.publish(bus.CMD_RELOAD)
    return _all(row)


# ── Фото сообщения ────────────────────────────────────────────────────
@router.put("/{key}/photo", response_model=TextsOut)
async def set_message_photo(
    key: str,
    admin: CurrentAdmin,
    db: DbSession,
    request: Request,
    file: UploadFile,
) -> TextsOut:
    """Своё фото для одного сообщения: бот покажет его вместо картинки меню."""
    _check_key(key)
    name = await _save_photo(file, f"text-{key}")

    row = await _config(db)
    photos = dict(row.message_photos or {})
    previous = photos.get(key)
    photos[key] = name
    # Присваиваем новый словарь: правку на месте SQLAlchemy не заметит.
    row.message_photos = photos
    _audit(db, admin, "bot.text_photo.set", request, key=key)
    await db.flush()
    await db.commit()  # видно боту ДО pub/sub-уведомления
    _drop_photo_file(previous)
    await bus.publish(bus.CMD_RELOAD)
    return _all(row)


@router.delete("/{key}/photo", response_model=TextsOut)
async def delete_message_photo(
    key: str, admin: CurrentAdmin, db: DbSession, request: Request
) -> TextsOut:
    _check_key(key)
    row = await _config(db)
    photos = dict(row.message_photos or {})
    previous = photos.pop(key, None)
    row.message_photos = photos
    _audit(db, admin, "bot.text_photo.delete", request, key=key)
    await db.flush()
    await db.commit()
    _drop_photo_file(previous)
    await bus.publish(bus.CMD_RELOAD)
    return _all(row)

