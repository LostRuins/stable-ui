<script setup lang="ts">
import {
    ElDialog,
} from 'element-plus';
import { SwipeDirection, useSwipe } from '@vueuse/core';
import ImageActions from '../components/ImageActions.vue';
import { computed, ref, watch } from 'vue';
import { useUIStore } from '@/stores/ui';
import { useOutputStore } from '@/stores/outputs';
import { db } from '@/utils/db';

const store = useOutputStore();
const uiStore = useUIStore();

const target = ref();
useSwipe(target, {
    onSwipeEnd(e: TouchEvent, direction: SwipeDirection) {
        if (direction === "RIGHT") uiStore.openModalToLeft()
        if (direction === "LEFT") uiStore.openModalToRight()
    },
});

const modalOpen = computed({
    get() {
        return uiStore.activeModal !== -1;
    },
    set() {
        uiStore.activeModal = -1;
    }
});

const currentOutput = ref(store.currentOutputs[0]);

watch(
    () => uiStore.activeModal,
    async () => {
        const output = store.currentOutputs.find(el => el.id === uiStore.activeModal);
        if (output) return currentOutput.value = output;
        currentOutput.value = await db.outputs.get(uiStore.activeModal) || store.currentOutputs[0];
    }
)

function handleClose() {
    modalOpen.value = false;
}

function downloadAvi() {
    if (!currentOutput.value?.extra_avi) return;

    // extra_avi format: data:video/avi;base64,AAAA...
    const base64 = currentOutput.value.extra_avi.split(',')[1];
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
    a.download = `output-${currentOutput.value.id ?? 'video'}.avi`;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
</script>

<template>
    <el-dialog
        :model-value="modalOpen"
        :width="currentOutput?.width"
        class="image-viewer"
        @closed="handleClose"
        align-center
    >
        <div class="main-output-container" ref="target">
            <!-- Replace background-image div with an actual <img> for saveability -->
            <div
                class="main-output"
                style="position: relative; display: flex; align-items: center; justify-content: center;"
            >
                <img
                    v-if="currentOutput?.image"
                    :src="currentOutput.image"
                    alt="Output image"
                    style="max-width: 100%; max-height: 100%; object-fit: contain;"
                />
            </div>
        </div>
        <div style="font-size: 18px; font-weight: 500;">{{currentOutput.prompt?.split("###")[0] || 'Unknown Creation'}}</div>
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; letter-spacing: 0.025em;">
            <div>Negative Prompt: {{currentOutput.prompt?.split("###")[1] || "None"}}</div>
            <span>Model: {{currentOutput.modelName || "Unknown"}} - </span>
            <span>Sampler: {{currentOutput.sampler_name || "Unknown"}} - </span>
            <span>Scheduler: {{currentOutput.scheduler || "Unknown"}} - </span>
            <span>Seed: {{currentOutput.seed || "Unknown"}} - </span>
            <span>Steps: {{currentOutput.steps || "Unknown"}} - </span>
            <span>CFG Scale: {{currentOutput.cfg_scale || "Unknown"}} - </span>
            <span>Clip Skip: {{currentOutput.clip_skip ?? "Unknown"}} - </span>
            <span>Dimensions: {{currentOutput.width || "???"}}x{{currentOutput.height || "???"}} - </span>
            <span>Frames: {{currentOutput.frames || "1"}}</span>
            <span v-if="currentOutput.extra_avi"> - <a href="#" @click.prevent="downloadAvi" style="cursor: pointer; color: var(--el-color-primary);">[Download AVI]</a></span>
        </div>
        <template #footer>
            <ImageActions 
                :image-data="currentOutput"
                :on-delete="handleClose" />
        </template>
    </el-dialog>
</template>

<style>
.main-output-container {
    display: flex;
    justify-content: center;
    background-color: var(--el-fill-color-light);
}

.main-output {
    width: 100%;
    height: 512px;
    max-height: 100%;
}

.image-viewer {
    width: 100%;
    max-width: 1024px;
    height: 72vh;
    display: flex;
    flex-direction: column;
}

.image-viewer > .el-dialog__header {
    padding: 12px 26px;
}

.image-viewer > .el-dialog__body {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 10px;
    text-align: center;
    word-break: keep-all;
    overflow-y: scroll;
    padding-top: 0;
    height: 100%;
}

.image-viewer > .el-dialog__footer {
    border-top: 1px solid var(--el-border-color);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    row-gap: 8px;
}

@media only screen and (max-width: 1280px) {
    .image-viewer {
        width: 720px;
    }
}

@media only screen and (max-width: 768px) {
    .image-viewer {
        width: 100%;
        height: 80vh;
    }

    .main-output {
        width: 100%;
        height: 40vh;
    }
}
</style>
