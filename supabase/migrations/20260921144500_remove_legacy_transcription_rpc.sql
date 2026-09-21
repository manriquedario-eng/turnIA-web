-- Remove legacy direct-consumption RPCs after the application has moved to
-- reserve/settle/refund transcription accounting. Keeping either overload
-- callable would bypass the reservation flow.
drop function if exists public.consume_ai_transcription_seconds(uuid,uuid,bigint);
drop function if exists public.consume_ai_transcription_seconds(uuid,uuid,bigint,text,uuid);
