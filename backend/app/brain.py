"""LLM-backed interview brain: question generation, rubric scoring, coaching.

All structured calls request max_tokens>=1200 — gpt-oss (Groq's free reasoning
model) has been observed returning an EMPTY string on tighter budgets, since it
spends its budget on hidden reasoning tokens before ever emitting the JSON.
Output is parsed leniently (code fences, fullwidth brackets some free models
emit instead of straight ASCII, brace-span extraction) before falling back to
one strict retry that tells the model its last reply wasn't valid JSON.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Iterator

from pydantic import BaseModel, ValidationError

from .config import Settings
from .llm_compat import chat, chat_stream
from .prompts import coaching_messages, questions_messages, scoring_messages
from .rubric import QuestionBank, RubricScore

logger = logging.getLogger("hiresense.brain")

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)
_BRACKET_MAP = str.maketrans({"【": "[", "】": "]", "「": "{", "」": "}"})


def _extract_json_span(text: str) -> str:
    """Grab the outermost {...} span — models sometimes wrap JSON in prose."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return text
    return text[start : end + 1]


def _clean_json_text(text: str) -> str:
    cleaned = _FENCE_RE.sub("", text.strip())
    cleaned = cleaned.translate(_BRACKET_MAP)
    return _extract_json_span(cleaned)


def _parse_lenient(text: str, model_cls: type[BaseModel]) -> BaseModel | None:
    """Try raw text, then progressively cleaned text, validating each."""
    for candidate in (text, _clean_json_text(text)):
        try:
            return model_cls.model_validate(json.loads(candidate))
        except (json.JSONDecodeError, ValidationError):
            continue
    return None


def _structured_call(
    messages: list[dict], model_cls: type[BaseModel], *, settings: Settings, trace_name: str,
) -> BaseModel:
    """One structured JSON call with a single strict-format retry on parse failure."""
    raw = chat(
        messages, model=settings.primary_model, fallback_model=settings.fallback_model,
        temperature=0.4, max_tokens=1200,
        metadata={"trace_name": trace_name},
    )
    parsed = _parse_lenient(raw, model_cls)
    if parsed is not None:
        return parsed

    logger.warning("[brain] %s: non-JSON reply, retrying strict: %.160s", trace_name, raw)
    retry_messages = messages + [
        {"role": "assistant", "content": raw},
        {"role": "user", "content": "That was not valid JSON. Reply with ONLY the JSON object, nothing else."},
    ]
    raw2 = chat(
        retry_messages, model=settings.primary_model, fallback_model=settings.fallback_model,
        temperature=0.2, max_tokens=1200,
        metadata={"trace_name": f"{trace_name}-retry"},
    )
    parsed = _parse_lenient(raw2, model_cls)
    if parsed is not None:
        return parsed
    raise ValueError(f"{trace_name}: model did not return valid JSON after retry")


def generate_questions(role: str, seniority: str, count: int, resume_text: str = "", *, settings: Settings) -> list[str]:
    bank = _structured_call(
        questions_messages(role, seniority, count, resume_text=resume_text), QuestionBank,
        settings=settings, trace_name="hiresense-questions",
    )
    assert isinstance(bank, QuestionBank)
    questions = bank.questions[:count]
    if len(questions) < count:
        # Pad defensively rather than crash a live session on a short list.
        questions += [f"Tell me about a challenging {role} problem you solved."] * (count - len(questions))
    return questions


def score_answer(role: str, seniority: str, question: str, answer: str, resume_text: str = "", *, settings: Settings) -> RubricScore:
    result = _structured_call(
        scoring_messages(role, seniority, question, answer, resume_text=resume_text), RubricScore,
        settings=settings, trace_name="hiresense-scoring",
    )
    assert isinstance(result, RubricScore)
    return result


def coach_stream(
    role: str, seniority: str, question: str, rubric: RubricScore, *, settings: Settings,
) -> Iterator[str]:
    return chat_stream(
        coaching_messages(role, seniority, question, rubric),
        model=settings.primary_model, fallback_model=settings.fallback_model,
        temperature=0.6, max_tokens=700,
        metadata={"trace_name": "hiresense-coaching"},
    )
