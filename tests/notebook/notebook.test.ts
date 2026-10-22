import { describe, it, expect, beforeEach } from 'vitest';
import { Notebook, Entry, NOTEBOOK_STORAGE_KEY } from '../../src/notebook/notebook';
import { TimeSeriesSampler } from '../../src/notebook/graph';

describe('Lab Notebook (logging, JSON/CSV export, localStorage persistence, graphs)', () => {
  beforeEach(() => {
    const nb = new Notebook();
    nb.clear();
    nb.save();
  });

  it('logs entries and round-trips through JSON export', () => {
    const nb = new Notebook();
    const e1: Entry = {
      timestamp: 1700000001000,
      simTime: 1.5,
      action: 'pour',
      vesselId: 'vessel_1',
      details: 'Added 10.0 mL of HCl to Beaker A',
      tempK: 298.15,
      pH: 1.0,
    };
    const e2: Entry = {
      timestamp: 1700000005000,
      simTime: 2.0,
      action: 'reaction',
      vesselId: 'vessel_1',
      details: 'Reaction fired: HCl(aq) + NaOH(aq) -> NaCl(aq) + H2O(l)',
      reaction: 'HCl(aq) + NaOH(aq) → NaCl(aq) + H₂O(l)',
      tempK: 304.8,
      pH: 7.0,
    };

    nb.log(e1);
    nb.log(e2);

    expect(nb.entries()).toHaveLength(2);

    const jsonStr = nb.toJSON();
    const parsed = JSON.parse(jsonStr) as Entry[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].action).toBe('pour');
    expect(parsed[0].details).toContain('Added 10.0 mL of HCl');
    expect(parsed[1].action).toBe('reaction');
    expect(parsed[1].pH).toBeCloseTo(7.0, 2);
  });

  it('exports CSV with header row and one properly escaped row per entry', () => {
    const nb = new Notebook();
    nb.log({
      timestamp: 1700000001000,
      simTime: 0.5,
      action: 'pour',
      vesselId: 'vessel_1',
      details: 'Added 10 mL HCl, 1.0 M ("stock")',
      tempK: 298.15,
      pH: 1.0,
    });
    nb.log({
      timestamp: 1700000002000,
      simTime: 1.0,
      action: 'ignite',
      vesselId: 'vessel_2',
      details: 'Spark applied to Flask B',
      tempK: 350.0,
      pH: 7.0,
    });

    const csv = nb.toCSV();
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3); // 1 header + 2 entry rows
    expect(lines[0]).toContain('timestamp');
    expect(lines[0]).toContain('action');
    expect(lines[0]).toContain('details');
    expect(lines[1]).toContain('"Added 10 mL HCl, 1.0 M (""stock"")"');
    expect(lines[2]).toContain('ignite');
  });

  it('restores saved entries via Notebook.load() after save()', () => {
    const nb = new Notebook();
    nb.log({
      timestamp: 1700000010000,
      simTime: 4.2,
      action: 'heat',
      details: 'Heated Beaker A with 5.0 kJ',
      tempK: 315.4,
      pH: 7.0,
    });
    nb.save();

    const restored = Notebook.load();
    expect(restored.entries()).toHaveLength(1);
    expect(restored.entries()[0].action).toBe('heat');
    expect(restored.entries()[0].details).toBe('Heated Beaker A with 5.0 kJ');
    expect(restored.entries()[0].tempK).toBeCloseTo(315.4, 2);
  });

  it('falls back to an empty notebook when localStorage contains corrupt data', () => {
    // Write corrupt JSON directly to storage
    Notebook.setRawStorage(NOTEBOOK_STORAGE_KEY, '{corrupt_json: [123');
    const fromCorruptJson = Notebook.load();
    expect(fromCorruptJson.entries()).toEqual([]);

    // Write valid JSON that is not an entry list
    Notebook.setRawStorage(NOTEBOOK_STORAGE_KEY, JSON.stringify({ unexpected: 'shape' }));
    const fromWrongShape = Notebook.load();
    expect(fromWrongShape.entries()).toEqual([]);
  });

  it('records and bounds time-series telemetry samples for temperature and pH graphs', () => {
    const sampler = new TimeSeriesSampler(5);
    for (let i = 1; i <= 7; i++) {
      sampler.record(i * 0.5, 298.15 + i * 2, 7.0 - i * 0.5);
    }
    const pts = sampler.getPoints();
    expect(pts).toHaveLength(5);
    expect(pts[0].simTime).toBeCloseTo(1.5, 4);
    expect(pts[4].simTime).toBeCloseTo(3.5, 4);
    expect(pts[4].tempC).toBeCloseTo(39.0, 2);
    expect(pts[4].pH).toBeCloseTo(3.5, 2);
  });
});
