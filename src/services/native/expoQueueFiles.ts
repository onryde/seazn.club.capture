import { Directory, File, Paths } from 'expo-file-system';
import type { QueueFiles } from '@/services/tapQueueStore';

/** A name, never a path: no separator, no `..`, so nothing climbs out of the folder. */
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * The app's own folders in the document directory, each to itself: the tap queue's `scoring` (S2 design §6.3) and
 * Match Day's `matchday` (MD-2 Task 3, the day's last good copy). Never one folder for both: the tap queue reads every
 * file in its folder as a match's queue. The document directory is safe from the system clearing it, unlike the cache,
 * and Android's Auto Backup leaves it alone (the secure store's backup rules include only shared preferences:
 * `test/androidBackup.test.ts`). Over expo-file-system's `File` and `Directory`. `move` is the platform's own, with
 * `overwrite`, and is NOT atomic over an existing file: on Android it deletes the target and then renames
 * (`CopyMoveStrategy.LocalFile.prepareAsDestination` and `tryNativeMove`, expo-file-system 57.0.7), so a kill between
 * the two leaves only the source. The store reads for that (`tapQueueStore`: a temp file that decodes is promoted).
 * What a phone does is a device claim.
 */
export function createExpoQueueFiles(name: 'scoring' | 'matchday'): QueueFiles {
  const folder = new Directory(Paths.document, name);
  let ready = false;
  const open = (): Directory => {
    if (!ready) {
      folder.create({ intermediates: true, idempotent: true });
      ready = true;
    }
    return folder;
  };
  const file = (name: string): File => {
    if (!NAME.test(name)) throw new Error('a queue file is named, not pathed');
    return new File(open(), name);
  };
  return {
    names: async () =>
      open()
        .list()
        .filter((entry): entry is File => entry instanceof File)
        .map((entry) => entry.name),
    read: async (name) => {
      const found = file(name);
      return found.exists ? found.text() : null;
    },
    write: async (name, text) => {
      file(name).write(text);
    },
    move: async (from, to) => {
      await file(from).move(file(to), { overwrite: true });
    },
    remove: async (name) => {
      const found = file(name);
      if (found.exists) found.delete();
    },
  };
}
