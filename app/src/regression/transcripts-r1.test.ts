// Recorded QA conversations of round 1 (0.1.4) replayed through the real render path (replay.ts).
import { loadFixture, replayTranscripts } from './replay.ts';

const all = loadFixture(new URL('./fixtures/qa-transcripts.json', import.meta.url));
replayTranscripts('r1', all.filter((c) => c.id.startsWith('r1-')));
