// rn-strudel example: one row per Strudel feature (COVERAGE.md), each with the pattern code that exercises it. "Play"
// loops the pattern so you can listen; "Test" plays it briefly and checks that sound came out. The web demo
// (../web-demo) plays the same code on stock Strudel in a browser, as the reference.
//
// The CPU panel has the A/B switches for everything rn-strudel and rn-web-audio-compat do natively, and a load meter:
// start a pattern, flip switches, measure.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Switch, Text, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { initStrudel, loadDefaultSamples, getStrudelOptions, setStrudelOptions, type StrudelEngine, type StrudelOptions } from 'rn-strudel';
import { measureAudioLoad, setNativeProcessorsEnabled, areNativeProcessorsEnabled } from 'rn-web-audio-compat';
import { GROUPS, ROWS } from '../conformance/rows';
import { runStrudelRow, summarizeStrudel } from '../conformance/runner';
import type { StrudelResult, StrudelRow, StrudelTestEnv } from '../conformance/types';

const AUTORUN = process.env.EXPO_PUBLIC_AUTORUN === '1';

// Stripped-down inline markdown for the cards: `code` stays, [text](link) keeps the text.
const plain = (md: string) => md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '');

function makeEnv(audible: () => boolean): StrudelTestEnv {
  return {
    platform: 'native',
    engine: () => initStrudel(),
    loadSamples: loadDefaultSamples,
    get audible() {
      return audible();
    },
    get playMs() {
      return audible() ? 3000 : 2500;
    },
  };
}

type Switches = StrudelOptions & { nativeProcessors: boolean; nativeClock: boolean };

export default function App() {
  const dark = useColorScheme() === 'dark';
  const c = dark ? darkColors : lightColors;
  const [results, setResults] = useState<Map<string, StrudelResult>>(new Map());
  const [running, setRunning] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [audible, setAudible] = useState(!AUTORUN);
  const [switches, setSwitches] = useState<Switches>({
    ...getStrudelOptions(),
    nativeProcessors: areNativeProcessorsEnabled(),
    nativeClock: true,
  });
  const [load, setLoad] = useState<string>('');
  const audibleRef = useRef(audible);
  audibleRef.current = audible;
  const env = useMemo(() => makeEnv(() => audibleRef.current), []);
  const busy = running !== null;

  const record = useCallback((id: string, r: StrudelResult) => {
    console.log(`[STRUDEL] ${r.ok ? 'PASS' : 'FAIL'} ${id}: ${r.detail} (${r.ms} ms)`);
    setResults((prev) => new Map(prev).set(id, r));
  }, []);

  const stopPlaying = useCallback(async () => {
    if (!playing) return;
    (await initStrudel()).scheduler.stop();
    setPlaying(null);
  }, [playing]);

  const play = useCallback(
    async (row: StrudelRow) => {
      const engine = await initStrudel();
      if (playing === row.id) {
        engine.scheduler.stop();
        setPlaying(null);
        return;
      }
      try {
        if (row.needsSamples) await loadDefaultSamples();
        engine.scheduler.setPattern(await engine.evaluate(row.code!));
        engine.scheduler.start();
        setPlaying(row.id);
      } catch (err) {
        record(row.id, { ok: false, detail: String((err as Error)?.message ?? err), ms: 0 });
      }
    },
    [playing, record]
  );

  const runOne = useCallback(
    async (row: StrudelRow) => {
      await stopPlaying();
      setRunning(row.id);
      record(row.id, await runStrudelRow(row, env));
      setRunning(null);
    },
    [env, record, stopPlaying]
  );

  const runAll = useCallback(async () => {
    await stopPlaying();
    const all = new Map<string, StrudelResult>();
    for (const row of ROWS) {
      if (!row.code) continue;
      setRunning(row.id);
      const r = await runStrudelRow(row, env);
      all.set(row.id, r);
      record(row.id, r);
    }
    setRunning(null);
    console.log(`[STRUDEL] done: ${summarizeStrudel(all, ROWS)}`);
  }, [env, record, stopPlaying]);

  // Built with EXPO_PUBLIC_AUTORUN=1: run everything silently on launch (automated checks; results go to the log).
  useEffect(() => {
    if (!AUTORUN) return;
    const id = setTimeout(() => void runAll(), 2000);
    return () => clearTimeout(id);
  }, [runAll]);

  const flip = useCallback(async (key: keyof Switches, value: boolean) => {
    setSwitches((s) => ({ ...s, [key]: value }));
    if (key === 'nativeProcessors') setNativeProcessorsEnabled(value);
    else if (key === 'nativeClock') (await initStrudel()).clock.setNative(value);
    else setStrudelOptions({ [key]: value });
  }, []);

  const measure = useCallback(async () => {
    const engine: StrudelEngine = await initStrudel();
    setLoad('measuring for 10 s…');
    const l = await measureAudioLoad(engine.context, 10, engine.sleep);
    if (!l) {
      setLoad('no timing data (is the native patch built in?)');
      return;
    }
    const text =
      `load ${l.loadPct.toFixed(0)}%, worst callback ${l.maxLoadPct.toFixed(0)}%, ${l.overBudget} over budget` +
      (l.kernels.length ? `\n${l.kernels.map((k) => `${k.name} ${k.avgUs.toFixed(0)} µs`).join(', ')}` : '');
    console.log(`[LOAD] ${playing ?? 'idle'} ${JSON.stringify(switches)} ${text.replace('\n', ' | ')}`);
    setLoad(text);
  }, [playing, switches]);

  const sections = useMemo(() => GROUPS.map((g) => ({ title: g, data: ROWS.filter((r) => r.group === g) })), []);

  const header = (
    <View style={[styles.panel, { backgroundColor: c.card }]}>
      <Text style={[styles.section, { color: c.fg, marginTop: 0 }]}>CPU savings (A/B)</Text>
      {(
        [
          ['nativeProcessors', 'Native effects (C++ kernels, WaveShaper curves)'],
          ['nativeClock', 'Native scheduler clock'],
          ['fdnReverb', 'FDN reverb for .room()'],
          ['reverbIrCache', 'Cache convolution impulse responses'],
          ['crackleCache', 'Crackle buffer pool'],
        ] as [keyof Switches, string][]
      ).map(([key, label]) => (
        <View key={key} style={styles.switchRow}>
          <Text style={{ color: c.fg, flexShrink: 1 }}>{label}</Text>
          <Switch value={switches[key]} onValueChange={(v) => void flip(key, v)} />
        </View>
      ))}
      <Text style={[styles.how, { color: c.muted }]}>Reverb and crackle switches apply from the next pattern start.</Text>
      <View style={styles.barRow}>
        <Pressable style={[styles.button, { borderColor: c.muted }]} disabled={busy} onPress={() => void measure()}>
          <Text style={{ color: c.fg }}>Measure audio load (10 s)</Text>
        </Pressable>
      </View>
      {load ? <Text style={[styles.how, { color: c.fg }]}>{load}</Text> : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={[styles.bar, { backgroundColor: c.bg }]}>
        <Text style={[styles.title, { color: c.fg }]}>Strudel on React Native</Text>
        <View style={styles.barRow}>
          <Pressable style={[styles.button, { borderColor: c.muted }]} disabled={busy} onPress={runAll}>
            <Text style={{ color: c.fg }}>{busy ? 'Running…' : 'Test all'}</Text>
          </Pressable>
          <Switch value={audible} onValueChange={setAudible} />
          <Text style={{ color: c.muted }}>sound during tests</Text>
        </View>
        <Text style={{ color: c.muted }}>{summarizeStrudel(results, ROWS)}</Text>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => <Text style={[styles.section, { color: c.fg }]}>{section.title}</Text>}
        renderItem={({ item }) => {
          const r = results.get(item.id);
          const enabled = !!item.code && !busy;
          return (
            <View style={[styles.card, { backgroundColor: c.card }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.name, { color: c.fg }]}>{plain(item.name)}</Text>
                <Text style={[styles.badge, badgeStyle(item.covered, c)]}>{item.covered}</Text>
              </View>
              <Text style={[styles.how, { color: c.muted }]}>{plain(item.how)}</Text>
              {item.code ? <Text style={[styles.code, { color: c.fg }]}>{item.code}</Text> : null}
              <View style={styles.cardHeader}>
                <Text style={[styles.result, { color: r ? (r.ok ? c.ok : c.bad) : c.muted }]}>
                  {running === item.id ? 'testing…' : r ? `${r.ok ? 'PASS' : 'FAIL'}: ${r.detail}` : ''}
                </Text>
                <View style={styles.barRow}>
                  <Pressable
                    style={[styles.button, { borderColor: c.muted, opacity: enabled ? 1 : 0.4 }]}
                    disabled={!enabled}
                    onPress={() => void play(item)}
                  >
                    <Text style={{ color: c.fg }}>{!item.code ? 'Not implemented' : playing === item.id ? 'Stop' : 'Play'}</Text>
                  </Pressable>
                  {item.code ? (
                    <Pressable
                      style={[styles.button, { borderColor: c.muted, opacity: enabled ? 1 : 0.4 }]}
                      disabled={!enabled}
                      onPress={() => void runOne(item)}
                    >
                      <Text style={{ color: c.fg }}>Test</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const lightColors = { bg: '#fff', fg: '#1a1a1a', muted: '#666', card: '#f2f2f2', ok: '#166534', bad: '#991b1b', okbg: '#dcfce7', partbg: '#fef3c7', part: '#92400e', nobg: '#fee2e2' };
const darkColors = { bg: '#111', fg: '#eee', muted: '#999', card: '#1d1d1d', ok: '#86efac', bad: '#fca5a5', okbg: '#14532d', partbg: '#78350f', part: '#fde68a', nobg: '#7f1d1d' };

function badgeStyle(covered: StrudelRow['covered'], c: typeof lightColors) {
  if (covered === 'yes') return { backgroundColor: c.okbg, color: c.ok };
  if (covered === 'partial') return { backgroundColor: c.partbg, color: c.part };
  return { backgroundColor: c.nobg, color: c.bad };
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  bar: { paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 22, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  panel: { borderRadius: 8, padding: 10, gap: 6, marginTop: 8 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  section: { fontSize: 17, fontWeight: '700', marginTop: 18, marginBottom: 6 },
  card: { borderRadius: 8, padding: 10, marginVertical: 4, gap: 4 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  how: { fontSize: 12 },
  code: { fontSize: 12, fontFamily: 'monospace' },
  result: { fontSize: 12, flexShrink: 1 },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  button: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
});
