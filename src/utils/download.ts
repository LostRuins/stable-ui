import { useOptionsStore } from '@/stores/options';
import { ElMessage } from 'element-plus';
import { convertBase64ToBlob } from './base64';
import { downloadZip, type InputWithSizeMeta } from 'client-zip';
import { db } from '@/utils/db';
import type { IndexableType } from 'dexie';

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

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const {image, id, ...jsonData} = output;
        // Make a valid file name, and only get first 128 characters so we don't break the max file name limit
        const fileName = `${i}-${output.seed}-${output.prompt}`.replace(/[/\\:*?"<>]/g, "").substring(0, 128).trimEnd();

        let savtype = optionsStore.imageDownloadType;
        if(image.startsWith("data:image/gif"))
        {
            savtype = "GIF"; // always save gifs as gif
        }

        if (savtype === "PNG") {
            toDownload.push({
                name: fileName + ".png",
                input: await convertBase64ToBlob(image, "image/png"),
            })
        } else if (savtype === "JPG") {
            toDownload.push({
                name: fileName + ".jpg",
                input: await convertBase64ToBlob(image, "image/jpeg"),
            })
        } else if (savtype === "GIF") {
            toDownload.push({
                name: fileName + ".gif",
                input: await convertBase64ToBlob(image, "image/gif"),
            })
        } else {
            toDownload.push({
                name: fileName + ".webp",
                input: await convertBase64ToBlob(image, "image/webp"),
            })
        }

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

export async function downloadImage(base64Data: string, fileName: string) {
    const optionsStore = useOptionsStore();

    const downloadLink = document.createElement("a");

    let blob: Blob | undefined;
    let savtype = optionsStore.imageDownloadType;
    if(base64Data.startsWith("data:image/gif"))
    {
        savtype = "GIF"; // always save gifs as gif
    }

    if (savtype === "PNG") {
        blob = await convertBase64ToBlob(base64Data, "image/png");
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = fileName.replace(/[/\\:*?"<>]/g, "").substring(0, 128).trimEnd() + ".png"; // Only get first 128 characters so we don't break the max file name limit
    } else if (savtype === "JPG") {
        blob = await convertBase64ToBlob(base64Data, "image/jpeg");
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = fileName.replace(/[/\\:*?"<>]/g, "").substring(0, 128).trimEnd() + ".jpg";
    } else if (savtype === "GIF") {
        blob = await convertBase64ToBlob(base64Data, "image/gif");
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = fileName.replace(/[/\\:*?"<>]/g, "").substring(0, 128).trimEnd() + ".gif";
    } else {
        downloadLink.href = base64Data;
        downloadLink.download = fileName.replace(/[/\\:*?"<>]/g, "").substring(0, 128).trimEnd() + ".webp";
    }

    downloadLink.click();

    if (blob) URL.revokeObjectURL(downloadLink.href);
}

export function downloadVideo(base64Data: string, fileName: string) {

    // extra_avi format: data:video/avi;base64,AAAA...
    const base64 = base64Data;
    if (!base64) return;

    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'video/avi' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}