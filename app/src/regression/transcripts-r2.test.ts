// Recorded QA conversations of round 2 (0.2) replayed through the real render path (replay.ts).
import { loadFixture, replayTranscripts } from './replay.ts';

const all = loadFixture(new URL('./fixtures/qa-transcripts.json', import.meta.url));
replayTranscripts('r2', all.filter((c) => c.id.startsWith('r2-')));
