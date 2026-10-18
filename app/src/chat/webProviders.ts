// Web search provider ids (Web Search Plus 5.1 set, docs/WSP-INTEGRATION.md) → display names. Pure.

/** Provider ids → names as their services write them (WSP 5.1 provider set); unknown ids keep their first letter up. */
const PROVIDERS: Record<string, string> = {
  brave: 'Brave',
  serper: 'Serper',
  tavily: 'Tavily',
  exa: 'Exa',
  linkup: 'Linkup',
  firecrawl: 'Firecrawl',
  you: 'You.com',
  youcom: 'You.com',
  parallel: 'Parallel',
  keenable: 'Keenable',
  searxng: 'SearXNG',
  querit: 'Querit',
  serpbase: 'SerpBase',
  tinyfish: 'TinyFish',
  octen: 'Octen',
  donsetch: 'DonSeTch',
  jina: 'Jina',
  scrapingbee: 'ScrapingBee',
};

export function providerName(id: string): string {
  const k = id.trim().toLowerCase();
  return PROVIDERS[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1) : id);
}
