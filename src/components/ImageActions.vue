<script setup lang="ts">
import { useGeneratorStore } from '@/stores/generator';
import { useOutputStore, type ImageData } from '@/stores/outputs';
import {
    StarFilled,
    Star,
    Refresh,
    Link,
    Delete,
    Download,
} from '@element-plus/icons-vue';
import {
    ElButton,
    ElMessage,
    ElMessageBox,
    ElDialog,
} from 'element-plus';
import { deflateRaw } from 'pako';
import { downloadImage } from '@/utils/download'
import { db } from '@/utils/db';
import { ref } from 'vue';
import { useUIStore } from "@/stores/ui";

const store = useGeneratorStore();
const outputStore = useOutputStore();

const props = defineProps<{
    imageData: ImageData;
    onDelete?: Function;
    showDismiss?: boolean;
}>();

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
        .then(() => {
            outputStore.deleteOutput(props.imageData.id);
            if (props.onDelete !== undefined) props.onDelete(props.imageData.id);
            ElMessage({
                type: 'success',
                message: 'Deleted Image',
            })
        })
}

const dismissImage = () => {
    useGeneratorStore().clearOutputs();
    useUIStore().showGeneratedImages = false;
    useGeneratorStore().clearQueue();
}

async function copyLink(imageData: ImageData) {
    const urlBase = window.location.origin;
    const linkParams = {
        prompt: imageData.prompt,
        width: imageData.width ? imageData.width : undefined,
        height: imageData.height ? imageData.height : undefined,
        steps: imageData.steps,
        cfg_scale: imageData.cfg_scale,
        sampler_name: imageData.sampler_name,
        model_name: imageData.modelName,
        seed: imageData.seed,
        clip_skip: imageData.clip_skip,
        frames: imageData.frames,
        scheduler: imageData.scheduler,
        extra_avi: imageData.extra_avi,
        enable_hr: imageData.enable_hr,
        send_as_refimg: imageData.send_as_refimg,
    }
    const path = window.location.pathname.replace("images", "");
    let link = `${urlBase}${path}?share=`;
    let toBeCompressed = "";
    let paramChar = "";
    for (const [key, value] of Object.entries(linkParams)) {
        if (!value) continue;
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
</script>

<template>
    <el-button @click="confirmDelete" type="danger" size="small" :icon="Delete" plain>Delete</el-button>
    <el-button @click="downloadImage(imageData.image, `${imageData.seed}-${imageData.prompt}`)" type="success" size="small" :icon="Download" plain>Download</el-button>
    <el-button v-if="!imageData.starred" @click="outputStore.toggleStarred(imageData.id)" type="warning" size="small" :icon="Star" plain>Star</el-button>
    <el-button v-if="imageData.starred" @click="outputStore.toggleStarred(imageData.id)" type="warning" size="small" :icon="StarFilled" plain>Unstar</el-button>
    <el-button @click="store.generateText2Img(imageData)" type="success" size="small" plain>Txt2img</el-button>
    <el-button @click="store.generateImg2Img(imageData.image)" type="success" size="small" plain>Img2img</el-button>
    <el-button @click="store.generateInpainting(imageData.image)" type="success" size="small" plain>Inpaint</el-button>
    <el-button v-if="showDismiss" @click="dismissImage()" type="success" size="small" plain>Dismiss</el-button>
    <el-button @click="copyLink(imageData)" type="success" :icon="Link" size="small" plain>Share</el-button></template>