import * as fs from 'fs';
import * as path from 'path';

function getContents(dirPath: string): string[] {
    let results: string[] = [];
    readDir(dirPath, dirPath, results);
    return results.sort();
}

function readDir(currentPath: string, mainPath: string, content: string[]): string[] {
    const items = fs.readdirSync(currentPath);

    for (const item of items) {
        const itemPath = path.join(currentPath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
            readDir(itemPath, mainPath, content);
        } else {
            content.push(path.relative(mainPath, itemPath));
        }
    }

    return content;
}

export function compareDirectories(dir1: string, dir2: string): boolean {
    const contDir1 = getContents(dir1);
    const contDir2 = getContents(dir2);

    if (contDir1.length !== contDir2.length) {
        return false;
    }

    for (let i = 0; i < contDir1.length; i++) {
        if (contDir1[i] !== contDir2[i]) {
            return false;
        }
    }

    return true;
}

export function copyFolderSync(from: string, to: string) {
    if (!fs.existsSync(to)) {
        fs.mkdirSync(to, { recursive: true });
    }

    const items = fs.readdirSync(from);

    for (const item of items) {
        const fromPath = path.join(from, item);
        const toPath = path.join(to, item);
        const stats = fs.statSync(fromPath);

        if (stats.isDirectory()) {
            copyFolderSync(fromPath, toPath);
        } else {
            fs.copyFileSync(fromPath, toPath);
        }
    }
}