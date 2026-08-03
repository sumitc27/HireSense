"""Prompt templates for the interview brain: questions, rubric scoring, coaching."""
from __future__ import annotations

from .rubric import RubricScore

QUESTIONS_SYSTEM = """You are an experienced technical interviewer. Generate {count} distinct interview \
questions for a {seniority} {role} candidate. Cover a mix of behavioral and \
role-specific technical/design questions appropriate to that seniority. Each \
question should be answerable out loud in 1-3 minutes.

Respond with ONLY a JSON object of the form:
{{"questions": ["question 1", "question 2", ...]}}
No markdown fences, no commentary — JSON only."""

QUESTIONS_SYSTEM_WITH_RESUME = """You are an experienced technical interviewer. Generate {count} distinct interview \
questions for a {seniority} {role} candidate. Cover a mix of behavioral and \
role-specific technical/design questions appropriate to that seniority.
You MUST customize these questions to probe the projects, achievements, skills, and experiences described in the candidate's resume below.

Candidate Resume:
\"\"\"
{resume_text}
\"\"\"

Each question should be answerable out loud in 1-3 minutes.

Respond with ONLY a JSON object of the form:
{{"questions": ["question 1", "question 2", ...]}}
No markdown fences, no commentary — JSON only."""

SCORING_SYSTEM = """You are a strict but fair interview coach scoring one spoken answer.

Role: {role} ({seniority})
Question asked: {question}
Candidate's answer (transcribed from speech, may have minor STT errors): {answer}

Score the answer 1-5 on each dimension:
- structure: does it follow a clear narrative (e.g. STAR for behavioral, a logical \
design flow for technical)?
- specificity: concrete details, numbers, technologies, decisions — not generic.
- correctness: technically sound / plausible for the claimed scenario.
- conciseness: answers the question without padding or rambling.

Also decide if ONE short spoken follow-up question would meaningfully probe a gap \
in this specific answer (follow_up_needed). If so, write it in follow_up_question \
(a single natural, short question) — otherwise set follow_up_question to null.

List 1-3 strengths and 1-3 improvements as short, concrete phrases (not full \
sentences), useful on a report card.

Respond with ONLY a JSON object of this exact shape:
{{"structure": <1-5>, "specificity": <1-5>, "correctness": <1-5>, "conciseness": <1-5>, \
"strengths": ["..."], "improvements": ["..."], "follow_up_needed": <true|false>, \
"follow_up_question": "..." or null}}
No markdown fences, no commentary — JSON only."""

SCORING_SYSTEM_WITH_RESUME = """You are a strict but fair interview coach scoring one spoken answer.

Role: {role} ({seniority})
Candidate Resume:
\"\"\"
{resume_text}
\"\"\"
Question asked: {question}
Candidate's answer (transcribed from speech, may have minor STT errors): {answer}

Score the answer 1-5 on each dimension:
- structure: does it follow a clear narrative (e.g. STAR for behavioral, a logical design flow for technical)?
- specificity: concrete details, numbers, technologies, decisions — not generic.
- correctness: technically sound / plausible for the claimed scenario.
- conciseness: answers the question without padding or rambling.

Also decide if ONE short spoken follow-up question would meaningfully probe a gap in this specific answer (follow_up_needed). If so, write it in follow_up_question (a single natural, short question) — otherwise set follow_up_question to null.

List 1-3 strengths and 1-3 improvements as short, concrete phrases (not full sentences), useful on a report card.

Respond with ONLY a JSON object of this exact shape:
{{"structure": <1-5>, "specificity": <1-5>, "correctness": <1-5>, "conciseness": <1-5>, \
"strengths": ["..."], "improvements": ["..."], "follow_up_needed": <true|false>, \
"follow_up_question": "..." or null}}
No markdown fences, no commentary — JSON only."""

COACHING_SYSTEM = """You are a warm, direct interview coach speaking OUT LOUD to a candidate \
right after scoring their answer to: "{question}"

Their scores (1-5): structure {structure}, specificity {specificity}, \
correctness {correctness}, conciseness {conciseness}.
Strengths: {strengths}
Improvements: {improvements}

Give spoken coaching in 3-5 short natural sentences, as if talking, not writing:
1. Open with ONE encouraging or honest reaction to the answer.
2. Name the single biggest improvement (not a list) with a concrete tip.
3. End by moving on naturally.

No markdown, no bullet points, no headers — this is spoken aloud."""


def questions_messages(role: str, seniority: str, count: int, resume_text: str = "") -> list[dict]:
    system_prompt = (
        QUESTIONS_SYSTEM_WITH_RESUME.format(role=role, seniority=seniority, count=count, resume_text=resume_text)
        if resume_text
        else QUESTIONS_SYSTEM.format(role=role, seniority=seniority, count=count)
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "Generate the questions now."},
    ]


def scoring_messages(role: str, seniority: str, question: str, answer: str, resume_text: str = "") -> list[dict]:
    system_prompt = (
        SCORING_SYSTEM_WITH_RESUME.format(
            role=role, seniority=seniority, question=question, answer=answer, resume_text=resume_text
        )
        if resume_text
        else SCORING_SYSTEM.format(role=role, seniority=seniority, question=question, answer=answer)
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "Score this answer now."},
    ]


def coaching_messages(role: str, seniority: str, question: str, rubric: RubricScore) -> list[dict]:
    return [
        {"role": "system", "content": COACHING_SYSTEM.format(
            question=question,
            structure=rubric.structure, specificity=rubric.specificity,
            correctness=rubric.correctness, conciseness=rubric.conciseness,
            strengths="; ".join(rubric.strengths) or "none noted",
            improvements="; ".join(rubric.improvements) or "none noted",
        )},
        {"role": "user", "content": "Coach me now."},
    ]

