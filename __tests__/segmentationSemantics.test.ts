import { CrossingEngine, UserCommand } from '../src/crossing/crossingEngine';
import { Phrase, Verbosity } from '../src/feedback/cue';
import { ObjectCategory } from '../src/perception/detection';
import { SEG_LABELS, segCategoryFor, segmentationLabels } from '../src/perception/segmentation';
import { det, frame } from './fixtures';

describe('segmentation evidence used for guidance', () => {
  test('broad surface labels never assert a crossing or a person', () => {
    for (const label of ['Markings', 'Paved', 'Road', 'People/Animals', 'Curb', 'Sidewalk']) {
      expect(segCategoryFor(label)).toBe(ObjectCategory.OTHER);
    }
    expect(segCategoryFor('Signals')).toBe(ObjectCategory.TRAFFIC_LIGHT);
    expect(segCategoryFor('Vehicles')).toBe(ObjectCategory.CAR);
  });

  test('reordered metadata controls meaning instead of the legacy class index', () => {
    const labels = segmentationLabels(3, ['Vehicles', 'Markings', 'crosswalk']);
    expect(labels.map(segCategoryFor)).toEqual([
      ObjectCategory.CAR, ObjectCategory.OTHER, ObjectCategory.CROSSWALK,
    ]);
  });

  test('missing metadata never silently adopts the AN-S3 taxonomy', () => {
    const labels = segmentationLabels(SEG_LABELS.length);
    expect(labels).toHaveLength(16);
    expect(labels.every(label => segCategoryFor(label) === ObjectCategory.OTHER)).toBe(true);
  });

  test('inconsistent metadata is rejected instead of relabelled', () => {
    expect(() => segmentationLabels(16, ['crosswalk'])).toThrow('labels do not match');
    expect(() => segmentationLabels(0)).toThrow('class count');
  });

  test.each([
    ['Markings', false], ['Paved', false], ['class_2', false], ['crosswalk', true],
  ])('repeated centred %s observations produce crosswalk aiming only with an explicit label', (label, expected) => {
    const engine = new CrossingEngine();
    engine.settings = { ...engine.settings, verbosity: Verbosity.DETAILED };
    engine.command(UserCommand.START_ASSIST, 0);
    const phrases: Phrase[] = [];
    for (let now = 0; now < 4_000; now += 100) {
      engine.onSensors(now, { timestampMs: now, headingDeg: 0, pitchDeg: 5 }, false);
      const output = engine.onFrame(frame(now, det(segCategoryFor(label))), { hfovDeg: 60, vfovDeg: 90 });
      for (const cue of output.cues) if (cue.kind === 'speak') phrases.push(cue.phrase);
    }
    expect(phrases.includes(Phrase.CROSSWALK_CENTERED)).toBe(expected);
    expect(phrases).not.toContain(Phrase.WALK_STARTED);
  });
});
