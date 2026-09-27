<script setup lang="ts">
import { useGeneratorStore } from '@/stores/generator';
import { useOutputStore, type ImageData, type OutputViewModel } from '@/stores/outputs';
import { db } from '@/utils/db';
import {
    StarFilled,
    Star,
    Link,
    Delete,
    Download,
} from '@element-plus/icons-vue';
import {
    ElButton,
    ElMessage,
    ElMessageBox,
} from 'element-plus';
import { deflateRaw } from 'pako';
import { downloadImage, downloadVideo } from '@/utils/download'
import { useUIStore } from "@/stores/ui";

const store = useGeneratorStore();
const outputStore = useOutputStore();

const props = defineProps<{
    imageData: ImageData | OutputViewModel;
    onDelete?: (id: number) => void;
    showDismiss?: boolean;
}>();

/**
 * ImageActions receives either a full ImageData row (gallery dialog) or a
 * string-free OutputViewModel (generation carousel). Consumers that need the
 * data-URL strings (image/extra_avi/final_frame) re-read the row from the DB
 * at click time; for a full row this is the identity, so their behavior is
 * unchanged.
 * */
const rowOf = async (imageData: ImageData | OutputViewModel): Promise<ImageData | undefined> =>
    "image" in imageData ? imageData : db.outputs.get(imageData.id);

const confirmDelete = () => {
    ElMessageBox.confirm(
        'This action will permanently delete this image. Continue?',
        'Warning',
        {
            confirmButtonText: 'OK',
            cancelButtonText: 'Cancel',
            type: 'warning',
        }
    )
        .then(async () => {
            await outputStore.deleteOutput(props.imageData.id);
            props.onDelete?.(props.imageData.id);
            ElMessage({
                type: 'success',
                message: 'Deleted Image',
            })
        })
}

const downloadImageButton = async (imageData: ImageData | OutputViewModel) => {
    const row = await rowOf(imageData);
    if (!row) return;
    if (row.extra_avi)
    {
        //its a video with avi
        // extra_avi format: data:video/avi;base64,AAAA...
        const base64 = row.extra_avi.split(',')[1];
        if (!base64) return;
        const filename = `${row.seed}-${row.prompt}.avi`;
        downloadVideo(base64,filename);
        return;
    } else {
        downloadImage(row.image, `${row.seed}-${row.prompt}`);
    }
}

const dismissImage = () => {
    useGeneratorStore().clearOutputs();
    useUIStore().showGeneratedImages = false;
    useGeneratorStore().clearQueue();
}

async function copyLink(imageData: ImageData | OutputViewModel) {
    const row = await rowOf(imageData);
    if (!row) return;
    const urlBase = window.location.origin;
    const linkParams = {
        prompt: row.prompt,
        width: row.width ? row.width : undefined,
        height: row.height ? row.height : undefined,
        steps: row.steps,
        cfg_scale: row.cfg_scale,
        eta: row.eta,
        sampler_name: row.sampler_name,
        model_name: row.modelName,
        seed: row.seed,
        clip_skip: row.clip_skip,
        frames: row.frames,
        fps: row.fps,
        scheduler: row.scheduler,
        extra_avi: row.extra_avi,
        final_frame: row.final_frame,
        enable_hr: row.enable_hr,
        send_as_refimg: row.send_as_refimg,
        lora_meta: row.lora_meta
    }
    const path = window.location.pathname.replace("images", "");
    let link = `${urlBase}${path}?share=`;
    let toBeCompressed = "";
    let paramChar = "";
    for (const [key, value] of Object.entries(linkParams)) {
        // eta=0 is meaningful (it overrides the sampler's default eta of 1), so
        // only values that are truly absent are skipped
        if (value === undefined || value === null || value === "" || (value === 0 && key !== "eta")) continue;
        let filteredValue = value;
        if (typeof value === "string") filteredValue = encodeURIComponent(value);
        else if (Array.isArray(value)) filteredValue = JSON.stringify(value);
        toBeCompressed += `${paramChar}${key}=${filteredValue}`
        paramChar = "&";
    }
    const compressedBase64 = btoa(String.fromCharCode.apply(null, Array.from(deflateRaw(toBeCompressed))));
    link += compressedBase64;
    await navigator.clipboard.writeText(link);
    ElMessage({
        type: 'success',
        message: 'Copied shareable link to clipboard',
    });
}

async function startTxt2Img(imageData: ImageData | OutputViewModel) {
    const row = await rowOf(imageData);
    if (row) store.generateText2Img(row);
}

async function startImg2Img(imageData: ImageData | OutputViewModel) {
    const row = await rowOf(imageData);
    if (row) store.generateImg2Img(row.image);
}

async function startInpainting(imageData: ImageData | OutputViewModel) {
    const row = await rowOf(imageData);
    if (row) store.generateInpainting(row.image);
}
</script>

<style scoped>
.compact-button {
  padding-left: 6px;
  padding-right: 6px;
  margin-left: 6px;
}
</style>

<template>
    <el-button class="compact-button" @click="confirmDelete" type="danger" size="small" :icon="Delete" plain>Delete</el-button>
    <el-button class="compact-button" @click="downloadImageButton(imageData)" type="success" size="small" :icon="Download" plain>Download</el-button>
    <el-button class="compact-button" v-if="!imageData.starred" @click="outputStore.toggleStarred(imageData.id)" type="warning" size="small" :icon="Star" plain>Star</el-button>
    <el-button class="compact-button" v-if="imageData.starred" @click="outputStore.toggleStarred(imageData.id)" type="warning" size="small" :icon="StarFilled" plain>Unstar</el-button>
    <el-button class="compact-button" @click="startTxt2Img(imageData)" type="success" size="small" plain>Txt2img</el-button>
    <el-button class="compact-button" @click="startImg2Img(imageData)" type="success" size="small" plain>Img2img</el-button>
    <el-button class="compact-button" @click="startInpainting(imageData)" type="success" size="small" plain>Inpaint</el-button>
    <el-button class="compact-button" v-if="showDismiss" @click="dismissImage()" type="success" size="small" plain>Dismiss</el-button>
    <el-button class="compact-button" @click="copyLink(imageData)" type="success" :icon="Link" size="small" plain>Share</el-button>
</template>
