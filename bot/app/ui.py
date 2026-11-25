"""Отрисовка экранов бота.

Экран — это одно сообщение: текст (или подпись к картинке), клавиатура и,
если в панели загружена картинка меню, само фото. Переходы между экранами
редактируют это сообщение, а не плодят новые.

Две особенности Telegram, из-за которых здесь не обойтись одним edit_text:

* подпись к фото ограничена 1024 символами против 4096 у обычного
  сообщения. Длинные экраны (инструкции по подключению) в подпись не
  влезают, поэтому показываются текстом — иначе отправка просто не пройдёт;
* тип сообщения на лету не меняется: текстовое нельзя превратить в фото и
  наоборот. При смене типа старое сообщение удаляется и шлётся новое.

Картинка отправляется файлом с диска (общий том с панелью), а не ссылкой:
в режиме по IP порт панели обычно закрыт файрволом, и Telegram не смог бы
её скачать. Первая отправка возвращает file_id, дальше используется он —
это быстрее и не грузит диск.
"""

import logging

from aiogram import Bot
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import FSInputFile, InlineKeyboardMarkup, InputMediaPhoto, Message

log = logging.getLogger("bot.ui")

# Лимит Telegram на подпись к медиа.
MAX_CAPTION = 1024

# Имя файла → file_id. Загруженная картинка живёт у Telegram, поэтому
# повторно отправлять сам файл не нужно. Кэш в памяти процесса: после
# перезапуска бота первая отправка просто загрузит файл заново.
_file_ids: dict[str, str] = {}


def reset_photo_cache(path: str | None = None) -> None:
    """Картинку заменили — забываем её file_id."""
    if path is None:
        _file_ids.clear()
    else:
        _file_ids.pop(path, None)


def _photo_input(path: str):
    return _file_ids.get(path) or FSInputFile(path)


def visible_length(text: str) -> int:
    """Сколько символов увидит клиент.

    Telegram считает лимит подписи по видимому тексту, а не по разметке:
    «<b>привет</b>» — это 6 символов, а не 15. Считаем так же, иначе
    длинная разметка выглядела бы влезающей, а Telegram отклонил бы
    сообщение целиком.
    """
    import re

    plain = re.sub(r"<[^>]+>", "", text)
    # &lt; &gt; &amp; &quot; — один символ каждый.
    return len(re.sub(r"&(?:lt|gt|amp|quot);", "x", plain))


def _remember(path: str, message: Message) -> None:
    if message.photo:
        _file_ids[path] = message.photo[-1].file_id


def _same_photo(message: Message, path: str) -> bool:
    """У сообщения уже та же картинка? Тогда её file_id менять не нужно."""
    cached = _file_ids.get(path)
    return bool(cached) and bool(message.photo) and message.photo[-1].file_id == cached


def fits_caption(text: str) -> bool:
    return visible_length(text) <= MAX_CAPTION


async def safe_edit(
    message: Message,
    text: str,
    reply_markup: InlineKeyboardMarkup | None = None,
    *,
    photo: str | None = None,
    **kwargs: object,
) -> None:
    """Показывает экран, по возможности редактируя текущее сообщение."""
    with_photo = bool(photo) and fits_caption(text)

    try:
        if with_photo:
            await _edit_as_photo(message, text, reply_markup, photo, **kwargs)
        else:
            await _edit_as_text(message, text, reply_markup, **kwargs)
    except TelegramBadRequest as exc:
        detail = str(exc).lower()
        if "message is not modified" in detail:
            return
        if (
            "message can't be edited" in detail
            or "there is no text in the message" in detail
            or "message to edit not found" in detail
        ):
            await send_screen(message, text, reply_markup, photo=photo, **kwargs)
            return
        raise


async def _edit_as_photo(message, text, reply_markup, photo, **kwargs) -> None:
    if message.photo and _same_photo(message, photo):
        await message.edit_caption(caption=text, reply_markup=reply_markup, **kwargs)
        return
    if message.photo:
        # У каждого сообщения может быть своя картинка: подпись меняется
        # вместе с экраном, поэтому подменяем и медиа, иначе осталась бы
        # картинка предыдущего экрана.
        media = InputMediaPhoto(
            media=_photo_input(photo),
            caption=text,
            parse_mode=ParseMode.HTML,
        )
        await message.edit_media(media, reply_markup=reply_markup)
        _remember(photo, message)
        return
    # Текстовое сообщение картинкой не станет — заменяем его новым.
    await _delete(message)
    await send_screen(message, text, reply_markup, photo=photo, **kwargs)


async def _edit_as_text(message, text, reply_markup, **kwargs) -> None:
    if message.photo:
        # Экран не влезает в подпись: показываем текстом вместо фото.
        await _delete(message)
        await send_screen(message, text, reply_markup, photo=None, **kwargs)
        return
    await message.edit_text(text, reply_markup=reply_markup, **kwargs)


async def send_screen(
    message: Message,
    text: str,
    reply_markup: InlineKeyboardMarkup | None = None,
    *,
    photo: str | None = None,
    **kwargs: object,
) -> Message:
    """Отправляет экран новым сообщением."""
    if photo and fits_caption(text):
        try:
            sent = await message.answer_photo(
                _photo_input(photo), caption=text, reply_markup=reply_markup, **kwargs
            )
            _remember(photo, sent)
            return sent
        except TelegramBadRequest as exc:
            # Картинка битая или недоступна — экран важнее оформления.
            log.warning("Не удалось отправить картинку меню %s: %s", photo, exc)
            reset_photo_cache(photo)
        except OSError as exc:
            log.warning("Картинка меню %s не читается: %s", photo, exc)
    return await message.answer(text, reply_markup=reply_markup, **kwargs)


async def replace_media(message: Message, photo: str) -> None:
    """Меняет саму картинку у существующего экрана."""
    await message.edit_media(
        InputMediaPhoto(media=_photo_input(photo), parse_mode=ParseMode.HTML)
    )


async def send_to_chat(
    bot: Bot, chat_id: int, text: str, *, photo: str | None = None
) -> None:
    """Сообщение клиенту вне экранов (напоминания, оплата).

    С фото — одним сообщением с подписью. Не влезло в подпись или картинка
    не отправилась: текст важнее оформления, шлём его отдельно.
    """
    if photo and fits_caption(text):
        try:
            sent = await bot.send_photo(chat_id, _photo_input(photo), caption=text)
            _remember(photo, sent)
            return
        except TelegramBadRequest as exc:
            log.warning("Не удалось отправить фото %s: %s", photo, exc)
            reset_photo_cache(photo)
        except OSError as exc:
            log.warning("Фото %s не читается: %s", photo, exc)
    await bot.send_message(chat_id, text)


async def _delete(message: Message) -> None:
    try:
        await message.delete()
    except TelegramBadRequest:
        pass
