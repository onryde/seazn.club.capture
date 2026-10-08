import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { CaptureEngineNative } from '@/engine/nativeModule';
import { FakeNativeModule } from '@/engine/testing/FakeNativeModule';
import { photoPortFor } from '@/hooks/photoPortWiring';
import type { PhotoOutcome } from '@/services/photoPort';

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
 * ports), so its photo wiring is read from its source, as `routedApp.drift.test.ts` reads the layout's. The
 * syntax tree has no comments, so a line commented out is not wiring. What it gives `photoPortFor`, what it
 * gives `chooseEngine` as `native`, and how often it loads the module.
 */
function wiringOf(source: string): { photo: string | null; engine: string | null; loads: number } {
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
  const result = { photo: null as string | null, engine: null as string | null, loads: 0 };
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

const SKELETON = (photo: string, load: string) => `
  export function createNativePorts() {
    // photo: photoPortFor(null),
    const native = ${load};
    const wired = chooseEngine({ dev: true, native });
    return { engine: wired.engine, photo: ${photo} };
  }`;

describe('createNativePorts hands the module it loaded once to the engine and to the photo port', () => {
  it('reads the wiring from a source, and tells a null, a second load and a stray name apart', () => {
    expect(wiringOf(SKELETON('photoPortFor(native)', 'loadCaptureEngineNative()'))).toEqual({
      photo: 'native',
      engine: 'native',
      loads: 1,
    });
    expect(wiringOf(SKELETON('photoPortFor(null)', 'loadCaptureEngineNative()')).photo).toBe(
      'null',
    );
    expect(
      wiringOf(SKELETON('createPhotoPort(native)', 'loadCaptureEngineNative()')).photo,
    ).toBeNull();
    expect(wiringOf(SKELETON('photoPortFor(native)', 'null')).loads).toBe(0);
  });

  it('the real createNativePorts: photoPortFor(native), chooseEngine({ native }), one load', () => {
    const source = readFileSync(join(__dirname, 'nativePorts.ts'), 'utf8');
    expect(wiringOf(source)).toEqual({ photo: 'native', engine: 'native', loads: 1 });
  });
});
