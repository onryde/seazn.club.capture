import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { CaptureEngineNative } from '@/engine/nativeModule';
import { FakeNativeModule } from '@/engine/testing/FakeNativeModule';
import { photoPortFor } from '@/hooks/photoPortWiring';
import type { PhotoOutcome } from '@/services/photoPort';
import { FEATURES } from '@/ui/features';

type Native = Pick<CaptureEngineNative, 'takePhoto'>;

describe('which photo port the composition root wires (spec §8)', () => {
  const ANSWERS: readonly PhotoOutcome[] = ['saved', 'failed'];
  let answered = 0;

  it.each(ANSWERS)('a tap asks the module exactly once and says its word: %s', async (word) => {
    const module = new FakeNativeModule();
    module.photoAnswer = word;
    await expect(photoPortFor(module).take()).resolves.toBe(word);
    expect(module.photoCalls).toBe(1);
    answered += 1;
  });

  it('answered both words (anti-vacuity)', () => {
    expect(ANSWERS).toHaveLength(2);
    expect(answered).toBe(2);
  });

  it('no module (iOS in S1, web) is a failed photo', async () => {
    await expect(photoPortFor(null).take()).resolves.toBe('failed');
  });

  it('a stale module without takePhoto is a failed photo, not an exception', async () => {
    const stale = {} as unknown as Native;
    await expect(photoPortFor(stale).take()).resolves.toBe('failed');
  });

  it('calls takePhoto on the module, so its this stays bound', async () => {
    const seen: unknown[] = [];
    const native = {
      takePhoto() {
        seen.push(this);
        return Promise.resolve('saved');
      },
    };
    await expect(photoPortFor(native).take()).resolves.toBe('saved');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(native);
  });
});

/**
 * `createNativePorts` is the composition root and no test renders it (it imports Expo Router and the device
 * ports), so its photo and scoring-link wiring is read from its source, as `routedApp.drift.test.ts` reads the
 * layout's. The syntax tree has no comments, so a line commented out is not wiring. What it gives `photoPortFor`,
 * what it gives `scoringLinkPortFor` (its module and each dependency as `name:initializer`, so `{ logger: throwaway }`
 * is not `{ logger }`), what `logger` and `hosts` are bound to there (the real ones the dependencies must name), what
 * it gives `chooseEngine` as `native`, and how often it loads the module.
 */
type Wiring = {
  photo: string | null;
  scoringLink: string | null;
  scoringLinkDeps: string | null;
  loggerBinding: string | null;
  hostsBinding: string | null;
  engine: string | null;
  /** R5: what it gives `createNativePower`, each dependency as `name:initializer`, sorted. */
  powerDeps: string | null;
  loads: number;
};

/** An object literal's properties as sorted `name:initializer`, so a swapped value is not the right name. */
function depsOf(deps: ts.Expression | undefined, file: ts.SourceFile): string | null {
  if (deps === undefined || !ts.isObjectLiteralExpression(deps)) return null;
  return deps.properties
    .map((property) =>
      ts.isShorthandPropertyAssignment(property)
        ? `${property.name.text}:${property.name.text}`
        : ts.isPropertyAssignment(property)
          ? `${property.name.getText(file)}:${property.initializer.getText(file)}`
          : '?',
    )
    .sort()
    .join(', ');
}

function wiringOf(source: string): Wiring {
  const file = ts.createSourceFile('nativePorts.ts', source, ts.ScriptTarget.Latest, true);
  const inside: ts.Node[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'createNativePorts')
      inside.push(node);
    ts.forEachChild(node, collect);
  };
  collect(file);
  const root = inside[0];
  if (root === undefined) throw new Error('no createNativePorts');
  const result: Wiring = {
    photo: null,
    scoringLink: null,
    scoringLinkDeps: null,
    loggerBinding: null,
    hostsBinding: null,
    engine: null,
    powerDeps: null,
    loads: 0,
  };
  const calledAs = (node: ts.CallExpression, name: string) =>
    ts.isIdentifier(node.expression) && node.expression.text === name;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && calledAs(node, 'loadCaptureEngineNative')) result.loads += 1;
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'photo') {
      const call = node.initializer;
      if (ts.isCallExpression(call) && calledAs(call, 'photoPortFor')) {
        result.photo = call.arguments.map((arg) => arg.getText(file)).join(', ');
      }
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'scoringLink') {
      const call = node.initializer;
      if (ts.isCallExpression(call) && calledAs(call, 'scoringLinkPortFor')) {
        result.scoringLink = call.arguments[0]?.getText(file) ?? null;
        result.scoringLinkDeps = depsOf(call.arguments[1], file);
      }
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'power') {
      const call = node.initializer;
      if (ts.isCallExpression(call) && calledAs(call, 'createNativePower')) {
        result.powerDeps = depsOf(call.arguments[0], file);
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      if (node.name.text === 'logger') result.loggerBinding = node.initializer.getText(file);
      if (node.name.text === 'hosts') result.hostsBinding = node.initializer.getText(file);
    }
    if (ts.isCallExpression(node) && calledAs(node, 'chooseEngine')) {
      const options = node.arguments[0];
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (property.name?.getText(file) !== 'native') continue;
          result.engine = ts.isShorthandPropertyAssignment(property)
            ? property.name.text
            : ts.isPropertyAssignment(property)
              ? property.initializer.getText(file)
              : null;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

const PHOTO = 'photoPortFor(native)';
const SCORING = 'scoringLinkPortFor(native, { logger, hosts })';
const LOAD = 'loadCaptureEngineNative()';
const POWER =
  'createNativePower({ native, os: Platform.OS, openSettings: () => Linking.openSettings(), logger })';
const POWER_DEPS =
  'logger:logger, native:native, openSettings:() => Linking.openSettings(), os:Platform.OS';
const SKELETON = (photo: string, scoring: string, load: string, power = POWER) => `
  export function createNativePorts() {
    // photo: photoPortFor(null),
    // scoringLink: scoringLinkPortFor(null, { logger, hosts }),
    const native = ${load};
    const logger = createLogger({ record, now: Date.now });
    const hosts = seaznHosts(env);
    const wired = chooseEngine({ dev: true, native });
    return { engine: wired.engine, photo: ${photo}, scoringLink: ${scoring}, power: ${power} };
  }`;

describe('createNativePorts hands the module it loaded once to the engine, the photo port, the scoring-link port and the battery port', () => {
  it('reads the wiring from a source, and tells a null, a second load, a stray name and a swapped dependency apart', () => {
    expect(wiringOf(SKELETON(PHOTO, SCORING, LOAD))).toEqual({
      photo: 'native',
      scoringLink: 'native',
      scoringLinkDeps: 'hosts:hosts, logger:logger',
      loggerBinding: 'createLogger({ record, now: Date.now })',
      hostsBinding: 'seaznHosts(env)',
      engine: 'native',
      powerDeps: POWER_DEPS,
      loads: 1,
    });
    // R5: the battery port without the module, or not through createNativePower, is not the wiring.
    expect(
      wiringOf(SKELETON(PHOTO, SCORING, LOAD, POWER.replace('{ native,', '{ native: null,')))
        .powerDeps,
    ).toContain('native:null');
    expect(wiringOf(SKELETON(PHOTO, SCORING, LOAD, 'createFakePower()')).powerDeps).toBeNull();
    expect(wiringOf(SKELETON('photoPortFor(null)', SCORING, LOAD)).photo).toBe('null');
    expect(wiringOf(SKELETON('createPhotoPort(native)', SCORING, LOAD)).photo).toBeNull();
    expect(
      wiringOf(SKELETON(PHOTO, 'scoringLinkPortFor(null, { logger, hosts })', LOAD)).scoringLink,
    ).toBe('null');
    // The inline port back (RP3 forbids it) is not wiring the pin recognises.
    expect(wiringOf(SKELETON(PHOTO, 'createScoringLinkPort(native)', LOAD)).scoringLink).toBeNull();
    expect(
      wiringOf(SKELETON(PHOTO, 'scoringLinkPortFor(native, { logger })', LOAD)).scoringLinkDeps,
    ).toBe('logger:logger');
    // A swapped dependency: the right names, the wrong values, which a names-only pin would pass.
    expect(
      wiringOf(
        SKELETON(PHOTO, 'scoringLinkPortFor(native, { logger: throwaway, hosts: [] })', LOAD),
      ).scoringLinkDeps,
    ).toBe('hosts:[], logger:throwaway');
    expect(
      wiringOf(
        SKELETON(PHOTO, 'scoringLinkPortFor(native, { logger, hosts: hosts.slice(1) })', LOAD),
      ).scoringLinkDeps,
    ).toBe('hosts:hosts.slice(1), logger:logger');
    expect(wiringOf(SKELETON(PHOTO, SCORING, 'null')).loads).toBe(0);
  });

  it('the real createNativePorts: photoPortFor(native), scoringLinkPortFor(native, { hosts, logger }), createNativePower({ native, … }), chooseEngine({ native }), one load', () => {
    const source = readFileSync(join(__dirname, 'nativePorts.ts'), 'utf8');
    expect(wiringOf(source)).toEqual({
      photo: 'native',
      scoringLink: 'native',
      scoringLinkDeps: 'hosts:hosts, logger:logger',
      loggerBinding: expect.stringMatching(/^createLogger\(/),
      hostsBinding: 'seaznHosts(env)',
      engine: 'native',
      powerDeps: POWER_DEPS,
      loads: 1,
    });
  });
});

/**
 * R4 and P10 (the D3 fixes plan's rulings, the controller's): the upload credential store follows the SAME mode store
 * the ports hand the app (a second `createModeStore(kv)` would never be loaded, so no credential would ever be kept),
 * and stores only when the root layout's switch says so. Read from source, as above.
 */
type RecordWiring = {
  /** The options parameter's default, as written. */
  options: string | null;
  /** What `const modeStore` is bound to, and what the returned `modeStore` property is. */
  modeStoreBinding: string | null;
  modeStoreProperty: string | null;
  /** What it gives `createUploadCredentialStore`, as sorted `name:initializer`. */
  uploadCredentialDeps: string | null;
};

function recordWiringOf(source: string): RecordWiring {
  const file = ts.createSourceFile('nativePorts.ts', source, ts.ScriptTarget.Latest, true);
  let root: ts.FunctionDeclaration | undefined;
  const find = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'createNativePorts') root = node;
    ts.forEachChild(node, find);
  };
  find(file);
  if (root === undefined) throw new Error('no createNativePorts');
  const result: RecordWiring = {
    options: root.parameters[0]?.initializer?.getText(file) ?? null,
    modeStoreBinding: null,
    modeStoreProperty: null,
    uploadCredentialDeps: null,
  };
  // Only the returned object's own properties: the credential store's deps hold a `modeStore` too.
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'modeStore'
    )
      result.modeStoreBinding = node.initializer?.getText(file) ?? null;
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      ts.isObjectLiteralExpression(node.expression)
    )
      for (const property of node.expression.properties) readPort(property);
    ts.forEachChild(node, visit);
  };
  const readPort = (property: ts.ObjectLiteralElementLike) => {
    const name = property.name?.getText(file);
    if (name === 'modeStore')
      result.modeStoreProperty = ts.isPropertyAssignment(property)
        ? property.initializer.getText(file)
        : name;
    if (name !== 'uploadCredential' || !ts.isPropertyAssignment(property)) return;
    const call = property.initializer;
    if (
      ts.isCallExpression(call) &&
      ts.isIdentifier(call.expression) &&
      call.expression.text === 'createUploadCredentialStore'
    )
      result.uploadCredentialDeps = depsOf(call.arguments[0], file);
  };
  visit(root);
  return result;
}

const UPLOAD_DEPS =
  'clock:clock, enabled:options.recordSend, kv:kv, logger:logger, modeStore:modeStore';
const RECORD_SKELETON = (upload: string, modeStore = 'modeStore') => `
  export function createNativePorts(options = { recordSend: false }) {
    const modeStore = createModeStore(kv);
    return { modeStore: ${modeStore}, uploadCredential: ${upload} };
  }`;
const UPLOAD =
  'createUploadCredentialStore({ kv, modeStore, clock, logger, enabled: options.recordSend })';

describe('createNativePorts keeps the upload credential on the app’s own mode store, behind the switch (R4, P10)', () => {
  it('reads the wiring, and tells a second mode store, a forced switch and a fake apart', () => {
    expect(recordWiringOf(RECORD_SKELETON(UPLOAD))).toEqual({
      options: '{ recordSend: false }',
      modeStoreBinding: 'createModeStore(kv)',
      modeStoreProperty: 'modeStore',
      uploadCredentialDeps: UPLOAD_DEPS,
    });
    expect(
      recordWiringOf(
        RECORD_SKELETON(UPLOAD.replace('modeStore,', 'modeStore: createModeStore(kv),')),
      ).uploadCredentialDeps,
    ).toContain('modeStore:createModeStore(kv)');
    expect(
      recordWiringOf(RECORD_SKELETON(UPLOAD.replace('options.recordSend', 'true')))
        .uploadCredentialDeps,
    ).toContain('enabled:true');
    expect(
      recordWiringOf(RECORD_SKELETON('createFakeUploadCredential()')).uploadCredentialDeps,
    ).toBeNull();
    expect(recordWiringOf(RECORD_SKELETON(UPLOAD, 'createModeStore(kv)')).modeStoreProperty).toBe(
      'createModeStore(kv)',
    );
  });

  it('the real createNativePorts: one mode store, handed to the app and to the credential store, switch passed', () => {
    const source = readFileSync(join(__dirname, 'nativePorts.ts'), 'utf8');
    expect(recordWiringOf(source)).toEqual({
      options: '{ recordSend: false }',
      modeStoreBinding: 'createModeStore(kv)',
      modeStoreProperty: 'modeStore',
      uploadCredentialDeps: UPLOAD_DEPS,
    });
  });

  it('the root layout passes the shipped switch, and the shipped switch is off until the web’s endpoint exists', () => {
    const source = readFileSync(join(__dirname, '../../app/_layout.tsx'), 'utf8');
    const file = ts.createSourceFile(
      '_layout.tsx',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const calls: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'createNativePorts'
      )
        calls.push(node.arguments.map((arg) => arg.getText(file)).join(', '));
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(calls).toEqual(['{ recordSend: FEATURES.recordSend }']);
    expect(FEATURES.recordSend).toBe(false);
  });
});
