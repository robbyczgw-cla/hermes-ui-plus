// Recorded QA conversations of round 3 (0.2) and the offline demo replayed through the real render path (replay.ts).
import { loadFixture, replayTranscripts } from './replay.ts';

const all = loadFixture(new URL('./fixtures/qa-transcripts.json', import.meta.url));
replayTranscripts('r3', all.filter((c) => c.id.startsWith('r3-') || c.id.startsWith('demo-')));
