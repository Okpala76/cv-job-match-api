# Render Deployment

Configure these environment variables in the Render service:

- `APP_API_KEY`: existing API authentication key.
- `SERPER_API_KEY`: Serper API key used by primary company search.
- `GROQ_API_KEY`: Groq API key used to evaluate Serper evidence.
- `GROQ_MODEL`: optional; defaults to `openai/gpt-oss-20b`. Strict structured
  output is enabled for Groq models that support it; other configured models
  use best-effort JSON Schema output followed by Pydantic validation.
- `GEMINI_API_KEY`: existing Gemini key used for company-research fallback and CV matching.
- `GEMINI_MODEL`: optional; defaults to `gemini-3.1-flash-lite`.

After adding the variables, deploy the latest commit. No Sheet or Apps Script
deployment is required for this provider change. Verify `/health`, then submit a
known company and confirm Render logs show `provider=serper_groq` without a
Gemini company-research call.
