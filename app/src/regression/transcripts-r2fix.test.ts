// Recorded QA conversations of the round-2 fix re-run (0.2) replayed through the real render path (replay.ts).
import { loadFixture, replayTranscripts } from './replay.ts';

const all = loadFixture(new URL('./fixtures/qa-transcripts.json', import.meta.url));
replayTranscripts('r2fix', all.filter((c) => c.id.startsWith('r2fix-')));
