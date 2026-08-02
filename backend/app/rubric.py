"""Pydantic models for the interview session: config, per-turn rubric, report."""
from __future__ import annotations

from pydantic import BaseModel, Field


class SessionConfig(BaseModel):
    role: str = Field(min_length=1, max_length=80)
    seniority: str = Field(min_length=1, max_length=40)
    question_count: int = Field(ge=1, le=6)


class QuestionBank(BaseModel):
    questions: list[str] = Field(min_length=1)


class RubricScore(BaseModel):
    structure: int = Field(ge=1, le=5)
    specificity: int = Field(ge=1, le=5)
    correctness: int = Field(ge=1, le=5)
    conciseness: int = Field(ge=1, le=5)
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    follow_up_needed: bool = False
    follow_up_question: str | None = None

    @property
    def overall(self) -> float:
        return round((self.structure + self.specificity + self.correctness + self.conciseness) / 4, 2)

    def to_dict(self) -> dict:
        d = self.model_dump()
        d["overall"] = self.overall
        return d


class TurnRecord(BaseModel):
    turn_id: str
    question_index: int
    is_follow_up: bool
    question_text: str
    answer_text: str
    answer_source: str = "voice"   # "voice" | "typed" | "skipped"
    rubric: RubricScore | None = None
    coaching_text: str = ""
    latency_ms: dict[str, int] = Field(default_factory=dict)

    def to_dict(self) -> dict:
        d = self.model_dump(exclude={"rubric"})
        d["rubric"] = self.rubric.to_dict() if self.rubric else None
        return d


class Report(BaseModel):
    role: str
    seniority: str
    turns: list[TurnRecord]
    completed: bool = True

    @property
    def overall_average(self) -> float:
        scored = [t.rubric.overall for t in self.turns if t.rubric]
        return round(sum(scored) / len(scored), 2) if scored else 0.0

    @property
    def top_improvements(self) -> list[str]:
        seen: list[str] = []
        for t in self.turns:
            if not t.rubric:
                continue
            for imp in t.rubric.improvements:
                if imp not in seen:
                    seen.append(imp)
        return seen[:3]

    def to_dict(self) -> dict:
        return {
            "role": self.role,
            "seniority": self.seniority,
            "completed": self.completed,
            "overall_average": self.overall_average,
            "top_improvements": self.top_improvements,
            "turns": [t.to_dict() for t in self.turns],
        }
