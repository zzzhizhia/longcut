-- Fix: Prevent user_videos FK failure from rolling back the video_analyses insert
--
-- Problem: insert_video_analysis_server runs video_analyses INSERT + user_videos INSERT
-- in a single transaction. If user_videos INSERT fails (e.g. profiles FK not ready for
-- new signups), the ENTIRE transaction rolls back — including the video_analyses row.
-- This means the video is never saved to the database, even though the client receives
-- the AI-generated results. Later, when the user tries to save a note, the notes API
-- can't find the video → 404 → "Failed to save note".
--
-- Fix: Wrap the user_videos INSERT in a nested BEGIN...EXCEPTION block so that a FK
-- failure only skips the user_videos link — the video_analyses row is always preserved.

CREATE OR REPLACE FUNCTION public.insert_video_analysis_server(
    p_youtube_id text,
    p_title text,
    p_author text,
    p_duration integer,
    p_thumbnail_url text,
    p_transcript jsonb,
    p_topics jsonb,
    p_summary jsonb DEFAULT NULL,
    p_suggested_questions jsonb DEFAULT NULL,
    p_model_used text DEFAULT NULL,
    p_user_id uuid DEFAULT NULL,
    p_language text DEFAULT NULL,
    p_available_languages jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_video_id uuid;
    v_existing_id uuid;
BEGIN
    -- Check if video already exists
    SELECT id INTO v_existing_id
    FROM public.video_analyses
    WHERE youtube_id = p_youtube_id;

    IF v_existing_id IS NULL THEN
        -- New video: insert with created_by set to the user who first generated it
        INSERT INTO public.video_analyses (
            youtube_id, title, author, duration, thumbnail_url,
            transcript, topics, summary, suggested_questions, model_used,
            language, available_languages, created_by
        ) VALUES (
            p_youtube_id, p_title, p_author, p_duration, p_thumbnail_url,
            p_transcript, p_topics, p_summary, p_suggested_questions, p_model_used,
            p_language, p_available_languages, p_user_id
        )
        RETURNING id INTO v_video_id;
    ELSE
        -- Video exists: update fields but DO NOT change created_by
        -- Only update non-null values to preserve existing data
        UPDATE public.video_analyses SET
            transcript = COALESCE(p_transcript, transcript),
            topics = COALESCE(p_topics, topics),
            summary = COALESCE(p_summary, summary),
            suggested_questions = COALESCE(p_suggested_questions, suggested_questions),
            language = COALESCE(p_language, language),
            available_languages = COALESCE(p_available_languages, available_languages),
            updated_at = timezone('utc'::text, now())
        WHERE id = v_existing_id;

        v_video_id := v_existing_id;
    END IF;

    -- Link to user if user_id provided (for user_videos tracking)
    -- Wrapped in a nested exception block so that a FK failure here
    -- (e.g. profiles row not yet created for new signups) does NOT
    -- roll back the video_analyses insert above.
    IF p_user_id IS NOT NULL THEN
        BEGIN
            INSERT INTO public.user_videos (user_id, video_id, accessed_at)
            VALUES (p_user_id, v_video_id, timezone('utc'::text, now()))
            ON CONFLICT (user_id, video_id) DO UPDATE SET
                accessed_at = timezone('utc'::text, now());
        EXCEPTION WHEN foreign_key_violation THEN
            -- Log the failure but let the function continue — the video is saved,
            -- and the user_videos link will be created later via ensureUserVideoLink
            -- or the fix_missing_user_videos migration's backfill logic.
            RAISE WARNING 'user_videos FK failed for user % on video % — skipping link',
                p_user_id, v_video_id;
        END;
    END IF;

    RETURN v_video_id;
END;
$$;
