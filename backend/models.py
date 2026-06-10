from typing import Optional, List
from enum import Enum
from sqlmodel import SQLModel, Field, Relationship
from datetime import datetime, date


# ── Enums ─────────────────────────────────────────────────────────────────────

class FitnessLevel(str, Enum):
    beginner     = "beginner"
    intermediate = "intermediate"
    advanced     = "advanced"


# ── User ──────────────────────────────────────────────────────────────────────

class UserBase(SQLModel):
    email: str = Field(index=True, unique=True)
    google_id: str = Field(index=True, unique=True)


class User(UserBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    # ── Profil użytkownika (v2) ────────────────────────────────────────────────
    display_name:   Optional[str]          = Field(default=None, max_length=64)
    avatar_url:     Optional[str]          = Field(default=None, max_length=512)
    fitness_level:  Optional[FitnessLevel] = Field(default=None)
    training_goal:  Optional[str]          = Field(default=None, max_length=64)

    # ── Relacje ────────────────────────────────────────────────────────────────
    strava_tokens:  Optional["StravaTokens"]  = Relationship(back_populates="user")
    saved_routes:   List["SavedRoute"]        = Relationship(back_populates="user")
    goals:          List["Goal"]              = Relationship(back_populates="user")
    training_plans: List["TrainingPlan"]      = Relationship(back_populates="user")


# ── Strava ────────────────────────────────────────────────────────────────────

class StravaTokens(SQLModel, table=True):
    id:                 Optional[int] = Field(default=None, primary_key=True)
    user_id:            int           = Field(foreign_key="user.id", unique=True)
    strava_athlete_id:  Optional[int] = Field(default=None)
    access_token:       str
    refresh_token:      str
    expires_at:         int
    user: User = Relationship(back_populates="strava_tokens")


# ── Saved Routes ──────────────────────────────────────────────────────────────

class SavedRouteBase(SQLModel):
    name:       Optional[str]   = Field(default="Moja pętla")
    geojson_data: str
    distance_m: Optional[float] = Field(default=None)

class SavedRoute(SavedRouteBase, table=True):
    id:         Optional[int] = Field(default=None, primary_key=True)
    user_id:    int           = Field(foreign_key="user.id")
    created_at: datetime      = Field(default_factory=datetime.utcnow)
    user: User = Relationship(back_populates="saved_routes")


# ── Goals ─────────────────────────────────────────────────────────────────────

class Goal(SQLModel, table=True):
    id:           Optional[int]   = Field(default=None, primary_key=True)
    user_id:      int             = Field(foreign_key="user.id", index=True)
    title:        str             = Field(description="Np. 'Półmaraton w Rzymie'")
    race_date:    date            = Field(description="Data zawodów")
    target_time:  Optional[str]   = Field(default=None, description="Np. '1:45:00'")
    distance_km:  Optional[float] = Field(default=None, description="Dystans wyścigu w km")
    notes:        Optional[str]   = Field(default=None)
    created_at:   datetime        = Field(default_factory=datetime.utcnow)

    user:           User               = Relationship(back_populates="goals")
    training_plans: List["TrainingPlan"] = Relationship(back_populates="goal")


# ── Training Plan ─────────────────────────────────────────────────────────────

class TrainingPlan(SQLModel, table=True):
    id:              Optional[int]   = Field(default=None, primary_key=True)
    user_id:         int             = Field(foreign_key="user.id", index=True)
    goal_id:         Optional[int]   = Field(default=None, foreign_key="goal.id")
    plan_date:       date            = Field(description="Dzień treningu")
    type:            str             = Field(description="Np. 'Interwały', 'Long Run', 'Easy Run', 'Rest'")
    description:     Optional[str]   = Field(default=None)
    distance_km:     Optional[float] = Field(default=None)

    # ── Stare pola (RAG v2) — zachowane dla kompatybilności ──────────────────
    target_pace:     Optional[str]   = Field(default=None, max_length=30,  description="Np. '5:20-5:30/km'")
    heart_rate_zone: Optional[str]   = Field(default=None, max_length=60,  description="Np. 'Z2 - Aerobowa (130-145 bpm)'")

    # ── Nowe pola (v3) — ustrukturyzowane fazy treningu ──────────────────────
    is_rest_day:          bool            = Field(default=False, description="True jeśli to dzień wolny/regeneracji")

    # Rozgrzewka
    warmup_distance_km:         Optional[float] = Field(default=None)
    warmup_exact_pace:          Optional[str]   = Field(default=None, max_length=20)
    warmup_heart_rate_target:   Optional[str]   = Field(default=None, max_length=30)
    warmup_beginner_explanation: Optional[str]  = Field(default=None, max_length=300)
    warmup_description:         Optional[str]   = Field(default=None, max_length=500)

    # Część główna
    main_distance_km:           Optional[float] = Field(default=None)
    main_exact_pace:            Optional[str]   = Field(default=None, max_length=20)
    main_heart_rate_target:     Optional[str]   = Field(default=None, max_length=30)
    main_beginner_explanation:  Optional[str]   = Field(default=None, max_length=300)
    main_target_pace:           Optional[str]   = Field(default=None, max_length=40)  # legacy alias
    main_description:           Optional[str]   = Field(default=None, max_length=800)

    # Schłodzenie
    cooldown_distance_km:           Optional[float] = Field(default=None)
    cooldown_exact_pace:            Optional[str]   = Field(default=None, max_length=20)
    cooldown_heart_rate_target:     Optional[str]   = Field(default=None, max_length=30)
    cooldown_beginner_explanation:  Optional[str]   = Field(default=None, max_length=300)
    cooldown_description:           Optional[str]   = Field(default=None, max_length=400)

    # Notatka trenera
    trainer_notes:              Optional[str]   = Field(default=None, max_length=600)

    created_at:      datetime        = Field(default_factory=datetime.utcnow)

    user: User           = Relationship(back_populates="training_plans")
    goal: Optional[Goal] = Relationship(back_populates="training_plans")

