import { useOptionsStore } from '@/stores/options';
import { ElMessage } from 'element-plus';
import { toMediaBlob, blobToDataUrl } from './media';
import { downloadZip, type InputWithSizeMeta } from 'client-zip';
import { db } from '@/utils/db';
import type { IndexableType } from 'dexie';

type SaveType = "PNG" | "JPG" | "GIF" | "WEBP";

const MIME_FOR_SAVE_TYPE: Record<SaveType, string> = {
    PNG: "image/png",
    JPG: "image/jpeg",
    GIF: "image/gif",
    WEBP: "image/webp",
};

const EXT_FOR_SAVE_TYPE: Record<SaveType, string> = {
    PNG: ".png",
    JPG: ".jpg",
    GIF: ".gif",
    WEBP: ".webp",
};

/**
 * Animated formats are saved as-is: a canvas re-encode would keep only the
 * first frame.
 */
function saveTypeFor(blob: Blob, preferred: SaveType, preserveAnimation: boolean): SaveType {
    if (blob.type === "image/gif") return "GIF";
    if (preserveAnimation && blob.type === "image/webp") return "WEBP";
    return preferred;
}

/**
 * A Blob in the requested save format: the stored Blob itself when the
 * format already matches (no re-encode), otherwise a canvas re-encode.
 */
async function toSaveBlob(blob: Blob, saveType: SaveType): Promise<Blob> {
    const target = MIME_FOR_SAVE_TYPE[saveType];
    if (blob.type === target) return blob;
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        const encoded = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, target));
        if (!encoded) throw new Error(`Re-encoding to ${target} failed`);
        return encoded;
    } finally {
        bitmap.close();
    }
}

export async function downloadMultipleImages(outputKeys: IndexableType[], showMessage = true, onProcess?: () => void) {
    const optionsStore = useOptionsStore();

    showMessage && ElMessage({
        message: `Downloading ${outputKeys.length} image(s)...`,
        type: 'info',
    })

    const toDownload: InputWithSizeMeta[] = []

    for (let i = 0; i < outputKeys.length; i++) {
        const output = await db.outputs.get(outputKeys[i]);
        if (!output) continue;

        const imageBlob = toMediaBlob(output.image);
        if (!imageBlob) continue;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const {image, id, ...jsonData} = output;
        // Make a valid file name, and only get first 128 characters so we don't break the max file name limit
        const fileName = `${i}-${output.seed}-${output.prompt}`.replace(/[/\\:*?"<>]/g, "").substring(0, 128).trimEnd();

        // The sidecar is JSON: a Blob field would stringify to `{}`, so
        // encode blob media back to data URLs — the form import reads from
        // sidecars — keeping the exported ZIP round-trippable
        if (jsonData.extra_avi instanceof Blob) jsonData.extra_avi = await blobToDataUrl(jsonData.extra_avi);
        if (jsonData.final_frame instanceof Blob) jsonData.final_frame = await blobToDataUrl(jsonData.final_frame);

        const savtype = saveTypeFor(imageBlob, optionsStore.imageDownloadType, Boolean(output.frames && output.frames > 1));
        toDownload.push({
            name: fileName + EXT_FOR_SAVE_TYPE[savtype],
            input: await toSaveBlob(imageBlob, savtype),
        })

        toDownload.push({
            name: fileName + ".json",
            input: JSON.stringify(jsonData, undefined, 4) // Stringify JSON with pretty printing
        })

        if (onProcess) onProcess();
    }

    const zipFile = await downloadZip(toDownload).blob();

    const downloadLink = document.createElement("a");
    downloadLink.href = URL.createObjectURL(zipFile);
    downloadLink.download = "sdui_images.zip";
    downloadLink.click();
}

export async function downloadImage(blob: Blob, fileName: string, preserveAnimation = false) {
    const optionsStore = useOptionsStore();
    const savtype = saveTypeFor(blob, optionsStore.imageDownloadType, preserveAnimation);
    const saved = await toSaveBlob(blob, savtype);

    const downloadLink = document.createElement("a");
    downloadLink.href = URL.createObjectURL(saved);
    // Only get first 128 characters so we don't break the max file name limit
    downloadLink.download = fileName.replace(/[/\\:*?"<>]/g, "").substring(0, 128).trimEnd() + EXT_FOR_SAVE_TYPE[savtype];
    downloadLink.click();
    URL.revokeObjectURL(downloadLink.href);
}

export function downloadVideo(blob: Blob, fileName: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}
