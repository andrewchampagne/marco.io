"""Routes each generation to the right provider.

Free-tier maps use the server's provider (`LLM_PROVIDER`, OpenAI by default). A BYOK request uses the
provider whose key it carries, whatever the server default is.
"""

from __future__ import annotations

from ..config import Settings
from .client import LLMError, LLMResult, MapGenerator, ProgressFn


class ProviderRouter:
    def __init__(self, settings: Settings, generators: dict[str, MapGenerator]):
        self.settings = settings
        self.generators = generators

    @property
    def model_id(self) -> str:
        return self.generators[self.settings.llm_provider].model_id

    async def generate(
        self,
        query: str,
        *,
        api_key: str | None = None,
        provider: str | None = None,
        web_search: bool = False,
        on_progress: ProgressFn | None = None,
    ) -> LLMResult:
        generator = self.generators.get(provider or self.settings.llm_provider)
        if generator is None:
            raise LLMError("llm_unconfigured", "That AI provider isn't available on this server.")
        return await generator.generate(query, api_key=api_key, web_search=web_search, on_progress=on_progress)

    async def aclose(self) -> None:
        for generator in self.generators.values():
            await generator.aclose()
