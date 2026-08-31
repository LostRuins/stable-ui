<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useGeneratorStore, getNewSeed } from '@/stores/generator';
import {
    type FormRules,
    ElCollapse,
    ElCollapseItem,
    ElForm,
    ElButton,
    ElCard,
    ElLink,
    ElMenu,
    ElTooltip,
    ElRow,
    ElCol,
    ElImage,
    ElSelect,
    ElOption,
    ElInputNumber
} from 'element-plus';
import {
    Comment,
    PictureFilled,
    MagicStick,
    CloseBold,
    ArrowUp,
    ArrowDown,
    Delete,
    Plus,
} from '@element-plus/icons-vue';
import BrushFilled from '../components/icons/BrushFilled.vue';
import ImageSearch from '../components/icons/ImageSearch.vue';
import ImageProgress from '../components/ImageProgress.vue';
import FormSlider from '../components/FormSlider.vue';
import FormSelect from '../components/FormSelect.vue';
import FormInput from '../components/FormInput.vue';
import FormSwitch from '../components/FormSwitch.vue';
import FormPromptInput from '../components/FormPromptInput.vue';
import GeneratedCarousel from '../components/GeneratedCarousel.vue'
import CustomCanvas from '../components/CustomCanvas.vue';
import GeneratorMenuItem from '../components/GeneratorMenuItem.vue';
import { useUIStore } from '@/stores/ui';
import { useCanvasStore } from '@/stores/canvas';
import { breakpointsTailwind, computedAsync, useBreakpoints } from '@vueuse/core';
import handleUrlParams from "@/router/handleUrlParams";
import InterrogationView from '@/components/InterrogationView.vue';
import { formatSeconds } from '@/utils/format';
import { parsePromptSegments } from '@/utils/expansions';
import { extractLoraRowsFromPrompt, allocateLoraRows } from '@/utils/loras';

const breakpoints = useBreakpoints(breakpointsTailwind);
const isMobile = breakpoints.smallerOrEqual('md');

const store = useGeneratorStore();
const uiStore = useUIStore();
const canvasStore = useCanvasStore();

const availableSamplers = computedAsync(async () => {
    const _ignore     = store.cacheVersion; // force update when cached value changes
    const samplers    = await store.getAvailableSamplers();
    const samplerList = samplers.map((el: any) => el.name);
    if (samplerList.length === 0) return [];
    return updateCurrentSampler(samplerList);
}, [])

const availableSchedulers = computedAsync(async () => {
    const _ignore       = store.cacheVersion; // force update when cached value changes
    const schedulers    = await store.getAvailableSchedulers();
    const schedulerList = schedulers.map((el: any) => el.name);
    if (schedulerList.length === 0) return [];
    return updateCurrentScheduler(schedulerList);
}, [])

// non-persisted LoRA list (name + multiplier pairs) on the generation screen.
// the server's LoRA list is fetched lazily: only if the panel is unfolded or
// at least one LoRA row is enabled, to avoid the round-trip by default
const loraListOpen = ref<"" | "lora-list">("");
const availableLoras = ref<any[]>([]);
const loraListLoaded = ref(false);
const loraListLoading = ref(false);

function loadLoraList() {
    if (loraListLoaded.value || loraListLoading.value) return;
    loraListLoading.value = true;
    store.fetchLoras().then(list => {
        // a failed fetch (null) keeps the list unloaded, so the next attempt retries
        if (list !== null) {
            availableLoras.value = list;
            loraListLoaded.value = true;
        }
    }).finally(() => { loraListLoading.value = false; });
}

function resetLocalLoraListCache() {
    availableLoras.value = [];
    loraListLoaded.value = false;
}

const loraEnabledCount = computed(() => store.loraList.filter(row => {
    const multiplier = Number(row.multiplier);
    return row.lora && row.lora.trim() !== "" && !isNaN(multiplier) && multiplier !== 0;
}).length);

watch(
    () => loraListOpen.value !== "" || loraEnabledCount.value > 0,
    needed => { if (needed) loadLoraList(); },
    { immediate: true },
);

watch(
    () => store.cacheVersion,
    () => {
        resetLocalLoraListCache();
        if (loraListOpen.value !== "" || loraEnabledCount.value > 0) {
            loadLoraList();
        }
    },
);

const loraSummary = computed(() => {
    const enabled = loraEnabledCount.value;
    const available = availableLoras.value.length;
    if (enabled === 0) return loraListLoaded.value ? `${available} available` : "";
    return loraListLoaded.value
        ? `${enabled} enabled, ${available} available`
        : `${enabled} enabled`;
});

const hasSelectedLora = (row: { lora: string }) => !!row.lora && row.lora.trim() !== "";
const loraNamedCount = computed(() => store.loraList.filter(hasSelectedLora).length);

// moves the rows with a selected LoRA out of the (non-persisted) LoRA list and appends
// them to the positive prompt as <lora:name:weight> tags; rows without a selection stay
function moveLorasToPrompt() {
    const moving = store.loraList.filter(hasSelectedLora);
    if (moving.length === 0) return;
    const tags = moving.map(row => {
        // the tag carries the LoRA's display name when the server list is loaded, the row's
        // raw (path) value otherwise; both resolve later against GET /sdapi/v1/loras
        const match = availableLoras.value.find(al => al.path === row.lora || al.name === row.lora);
        const multiplier = Number(row.multiplier);
        const weight = isNaN(multiplier) ? 0 : Math.round(multiplier * 10000) / 10000;
        return `<lora:${match ? match.name : row.lora}:${weight}>`;
    });
    store.loraList = store.loraList.filter(row => !hasSelectedLora(row));
    store.prompt = store.prompt === "" ? tags.join(" ") : `${store.prompt} ${tags.join(" ")}`;
}

// moves the LoRA tags of the positive prompt into the (non-persisted) LoRA
// list — the reverse of moveLorasToPrompt: each convertible tag becomes a row
// (the trailing empty rows are reused first); tags inside {a|b} expansion
// options, with an invalid weight, with the |high_noise| prefix, or with an
// empty name are left in the prompt
const promptLoraTagCount = computed(() => extractLoraRowsFromPrompt(store.prompt, parsePromptSegments(store.prompt))[1].length);

function moveLorasFromPrompt() {
    const [cleanedPrompt, extracted] = extractLoraRowsFromPrompt(store.prompt, parsePromptSegments(store.prompt));
    if (extracted.length === 0) return;
    const incoming = extracted.map(entry => {
        // the row holds the LoRA's path when the server list is loaded (the
        // row's select is optioned by path), the tag's raw name otherwise —
        // generateImage resolves rows by name or path either way
        const match = availableLoras.value.find(al => al.path === entry.name || al.name === entry.name);
        return { lora: match ? match.path : entry.name, multiplier: entry.multiplier };
    });
    store.loraList = allocateLoraRows(store.loraList, incoming);
    store.prompt = cleanedPrompt;
}

const rules = reactive<FormRules>({
    prompt: [{
        required: true,
        message: 'Please input prompt',
        trigger: 'change'
    }]
});

function updateCurrentSampler(newSamplers: string[]) {
    if (!store.params) return newSamplers;
    if (!store.params.sampler_name) return newSamplers;
    if (newSamplers.indexOf(store.params.sampler_name) === -1) {
        store.params.sampler_name = newSamplers[0] as any;
    }
    return newSamplers;
}

function updateCurrentScheduler(newSchedulers: string[]) {
    if (!store.params) return newSchedulers;
    if (!store.params.scheduler) return newSchedulers;
    if (newSchedulers.indexOf(store.params.scheduler) === -1) {
        store.params.scheduler = newSchedulers[0] as any;
    }
    return newSchedulers;
}

function formatEST(seconds: number) {
    return "Elapsed: " + formatSeconds(seconds, true, { days: true, hours: true, minutes: true, seconds: true })
}

function disableBadge() {
    if (!store.validGeneratorTypes.includes(store.generatorType)) uiStore.showGeneratorBadge = false;
}

function onMenuChange(key: any) {
    store.generatorType = key;
    disableBadge();
    console.log(key)
}

function onDimensionsChange() {
    canvasStore.showCropPreview = true;
    canvasStore.updateCropPreview();
}

function selectExtraImages() {
    document.getElementById('extra_image_input')?.click();
}

function selectVideoStartFrame() {
    document.getElementById('video_start_frame_input')?.click();
}

function selectVideoEndFrame() {
    document.getElementById('video_end_frame_input')?.click();
}

function isReferenceImage(image: { dataUrl?: string }) {
    return image.dataUrl?.startsWith('data:image');
}

function getReferenceImagePreviewList() {
    return store.referenceImages
        .filter(isReferenceImage)
        .map(referenceImage => referenceImage.dataUrl);
}

function getReferenceImagePreviewIndex(index: number) {
    return store.referenceImages
        .slice(0, index)
        .filter(isReferenceImage)
        .length;
}

disableBadge();
handleUrlParams();
</script>

<template>
    <el-menu
        :default-active="store.generatorType"
        :collapse="true"
        @select="onMenuChange"
        :mode="isMobile ? 'horizontal' : 'vertical'"
        :class="isMobile ? 'mobile-generator-types' : 'generator-types'"
        :style="isMobile ? 'overflow-x: auto' : ''"
    >
        <GeneratorMenuItem index="Text2Img"      :icon-one="Comment"           :icon-two="PictureFilled" :isMobile="isMobile" />
        <GeneratorMenuItem index="Img2Img"       :icon-one="PictureFilled"     :icon-two="PictureFilled" :isMobile="isMobile" />
        <GeneratorMenuItem index="Inpainting"    :icon-one="BrushFilled"       :icon-two="PictureFilled" :isMobile="isMobile" />
        <GeneratorMenuItem index="Interrogation" :icon-one="ImageSearch"       :isMobile="isMobile" />
    </el-menu>
    <div class="form">
        <div v-if="store.generatorType === 'Interrogation'" style="padding-bottom: 50px;">
            <h1 style="margin: 0">Interrogation</h1>
            <div>Interrogate images to get their predicted descriptions.</div>
            <InterrogationView />
        </div>
        <el-form
            label-position="left"
            label-width="140px"
            :model="store"
            class="container"
            :rules="rules"
            @submit.prevent
            v-else
        >
            <div class="sidebar">
                <form-prompt-input />
                <form-input
                    label="Negative Prompt"
                    prop="negativePrompt"
                    v-model="store.negativePrompt"
                    :autosize="{ maxRows: 15 }"
                    resize="vertical"
                    type="textarea"
                    placeholder="Enter negative prompt here"
                    info="What to exclude from the image. Not working? Try increasing the guidance."
                    label-position="top"
                >
                </form-input>
                <form-input label="Seed" prop="seed" v-model="store.params.seed" placeholder="Enter seed here" clearable :clear-icon="CloseBold">
                    <template #append>
                        <el-tooltip content="Randomize!" placement="top">
                            <el-button :icon="MagicStick" @click="() => store.params.seed = getNewSeed()" />
                        </el-tooltip>
                    </template>
                </form-input>
                <el-row :gutter="10" v-if="true">
                    <el-col :span="isMobile ? 24 : 12" v-if="store.multiSelect.sampler.state === 'Multiple'">
                        <form-select label="Sampler(s)"            prop="samplers"        v-model="store.multiSelect.sampler.selected"     :options="availableSamplers"  info="Multi-select enabled. Heun and DPM2 double generation time per step, but converge twice as fast." multiple />
                    </el-col>
                    <el-col :span="isMobile ? 24 : 12" v-if="store.multiSelect.sampler.state === 'Enabled'">
                        <form-select label="Sampler"               prop="sampler"         v-model="store.params.sampler_name"              :options="availableSamplers"  info="Heun and DPM2 double generation time per step, but converge twice as fast." />
                    </el-col>
                    <el-col :span="isMobile ? 24 : 12" v-if="store.multiSelect.scheduler.state === 'Multiple'">
                        <form-select label="Scheduler(s)"         prop="schedulers"      v-model="store.multiSelect.scheduler.selected"    :options="availableSchedulers" info="Multi-select enabled. Experimental! KoboldCpp only, allows you to use a different scheduler. Leave as default otherwise." multiple />
                    </el-col>
                    <el-col :span="isMobile ? 24 : 12" v-if="store.multiSelect.scheduler.state === 'Enabled'">
                        <form-select label="Scheduler"             prop="scheduler"       v-model="store.params.scheduler"            :options="availableSchedulers" info="Experimental! KoboldCpp only, allows you to use a different scheduler. Leave as default otherwise." />
                    </el-col>
                </el-row>
                <form-slider label="Batch Size"            prop="batchSize"       v-model="store.params.n"                         :min="store.minImages"        :max="store.maxImages" />
                <form-slider label="Steps(s)"              prop="multiSteps"      v-model="store.multiSelect.steps.selected"       :min="store.minSteps"         :max="store.maxSteps"      info="Multi-select enabled. Keep step count between 30 to 50 for optimal generation times. Coherence typically peaks between 60 and 90 steps, with a trade-off in speed." multiple v-if="store.multiSelect.steps.state === 'Multiple'" />
                <form-slider label="Steps"                 prop="steps"           v-model="store.params.steps"                     :min="store.minSteps"         :max="store.maxSteps"      info="Keep step count between 30 to 50 for optimal generation times. Coherence typically peaks between 60 and 90 steps, with a trade-off in speed." v-else-if="store.multiSelect.steps.state === 'Enabled'" />
                <form-slider label="Width"                 prop="width"           v-model="store.params.width"                     :min="store.minDimensions"    :max="store.maxDimensions" :step="64"   :change="onDimensionsChange" />
                <form-slider label="Height"                prop="height"          v-model="store.params.height"                    :min="store.minDimensions"    :max="store.maxDimensions" :step="64"   :change="onDimensionsChange" />
                <form-slider label="Guidance(s)"           prop="cfgScales"       v-model="store.multiSelect.guidance.selected"    :min="store.minCfgScale"      :max="store.maxCfgScale"   info="Multi-select enabled. Higher values will make the AI respect your prompt more. Lower values allow the AI to be more creative." multiple v-if="store.multiSelect.guidance.state === 'Multiple'" />
                <form-slider label="Guidance"              prop="cfgScale"        v-model="store.params.cfg_scale"                 :min="store.minCfgScale"      :max="store.maxCfgScale"   :step="0.5"  info="Higher values will make the AI respect your prompt more. Lower values allow the AI to be more creative." v-else-if="store.multiSelect.guidance.state === 'Enabled'" />
                <form-slider label="Eta"                   prop="eta"             v-model="store.params.eta"                       :min="store.minEta"           :max="store.maxEta"        :step="0.1"  info="Noise multiplier for ancestral samplers. 0 disables noise injection." v-if="store.multiSelect.eta.state === 'Enabled'" />
                <form-slider label="CLIP Skip(s)"          prop="clipSkips"       v-model="store.multiSelect.clipSkip.selected"    :min="store.minClipSkip"      :max="store.maxClipSkip"   info="Multi-select enabled. Last layers of CLIP to ignore. For most situations this can be left alone." multiple v-if="store.multiSelect.clipSkip.state === 'Multiple'" />
                <form-slider label="CLIP Skip"             prop="clipSkip"        v-model="store.params.clip_skip"                 :min="store.minClipSkip"      :max="store.maxClipSkip"   info="Last layers of CLIP to ignore. For most situations this can be left alone." v-else-if="store.multiSelect.clipSkip.state === 'Enabled'" />
                <form-slider label="Init Strength"         prop="denoise"         v-model="store.params.denoising_strength"        :min="store.minDenoise"       :max="store.maxDenoise"    :step="0.01" info="The final image will diverge from the starting image at higher values. 0=unchanged, 1=fullychanged" v-if="store.sourceGeneratorTypes.includes(store.generatorType)" />
                <form-slider label="Video Frames"          prop="frames"          v-model="store.params.frames"                    :min="store.minFrames"        :max="store.maxFrames"     info="Number of consecutive video frames to generate (Video models only). More frames increases memory usage."/>
                <form-slider label="FPS"                   prop="fps"             v-model="store.params.fps"                       :min="store.minFps"           :max="store.maxFps"        :disabled="store.params.frames <= 1" info="Frames per second for video generation." v-if="store.params.frames > 1" />
                <div
                    class="reference-images"
                    v-if="store.generatorType === 'Text2Img'"
                    @dragover.prevent
                    @drop.prevent="store.setExtraImage($event)"
                >
                    <div class="reference-images-header">
                        <span class="reference-images-label">Reference Images</span>
                        <div class="reference-images-actions">

                            <input
                                class="reference-images-input"
                                type="file"
                                id="extra_image_input"
                                @change="store.setExtraImage($event)"
                                accept="image/*"
                                multiple
                            />
                            <el-button @click="selectExtraImages">
                                Select or Drag Files
                            </el-button>
                            <el-button
                                @click="store.clearExtraImage()"
                                :disabled="store.referenceImages.length === 0"
                            >
                                Clear Images
                            </el-button>
                        </div>
                    </div>
                    <div class="reference-image-list" v-if="store.referenceImages.length > 0">
                        <div
                            class="reference-image-item"
                            :class="{ 'reference-file-item': !isReferenceImage(image) }"
                            v-for="(image, index) in store.referenceImages"
                            :key="image.id"
                        >
                            <span class="reference-image-index">{{ index + 1 }}</span>
                            <el-image
                                v-if="isReferenceImage(image)"
                                class="reference-image-thumb"
                                :src="image.dataUrl"
                                fit="cover"
                                :preview-src-list="getReferenceImagePreviewList()"
                                :initial-index="getReferenceImagePreviewIndex(index)"
                                preview-teleported
                            />
                            <span class="reference-image-name" :title="image.name">{{ image.name }}</span>
                            <div class="reference-image-controls">
                                <el-tooltip content="Move up" placement="top">
                                    <el-button
                                        class="small-btn"
                                        :icon="ArrowUp"
                                        :disabled="index === 0"
                                        @click="store.moveExtraImage(index, -1)"
                                    />
                                </el-tooltip>
                                <el-tooltip content="Move down" placement="top">
                                    <el-button
                                        class="small-btn"
                                        :icon="ArrowDown"
                                        :disabled="index === store.referenceImages.length - 1"
                                        @click="store.moveExtraImage(index, 1)"
                                    />
                                </el-tooltip>
                                <el-tooltip content="Remove" placement="top">
                                    <el-button
                                        class="small-btn"
                                        type="danger"
                                        :icon="Delete"
                                        plain
                                        @click="store.removeExtraImage(index)"
                                    />
                                </el-tooltip>
                            </div>
                        </div>
                    </div>
                    <div class="reference-image-empty" v-else>
                        No reference images selected.
                    </div>
                </div>
                <div class="video-frame-selectors" v-if="store.generatorType === 'Text2Img' && store.params.frames > 1">
                    <div class="video-frame-selector">
                        <input
                            class="reference-images-input"
                            type="file"
                            id="video_start_frame_input"
                            @change="store.setVideoStartFrame($event)"
                            accept="image/*"
                        />
                        <span class="video-frame-label">Video Start Frame</span>
                        <el-image
                            v-if="store.videoStartFrame"
                            class="reference-image-thumb"
                            :src="store.videoStartFrame.dataUrl"
                            fit="cover"
                            preview-teleported
                        />
                        <div class="reference-image-thumb video-frame-thumb-empty" v-else></div>
                        <span
                            class="video-frame-name"
                            :title="store.videoStartFrame?.name || 'No image selected'"
                        >
                            {{ store.videoStartFrame?.name || 'No image selected' }}
                        </span>
                        <div class="video-frame-actions">
                            <el-button @click="selectVideoStartFrame">
                                Select Image
                            </el-button>
                            <el-tooltip content="Remove" placement="top">
                                <el-button
                                    class="small-btn"
                                    type="danger"
                                    :icon="Delete"
                                    plain
                                    :disabled="!store.videoStartFrame"
                                    @click="store.clearVideoStartFrame()"
                                />
                            </el-tooltip>
                        </div>
                    </div>
                    <div class="video-frame-selector">
                        <input
                            class="reference-images-input"
                            type="file"
                            id="video_end_frame_input"
                            @change="store.setVideoEndFrame($event)"
                            accept="image/*"
                        />
                        <span class="video-frame-label">Video End Frame</span>
                        <el-image
                            v-if="store.videoEndFrame"
                            class="reference-image-thumb"
                            :src="store.videoEndFrame.dataUrl"
                            fit="cover"
                            preview-teleported
                        />
                        <div class="reference-image-thumb video-frame-thumb-empty" v-else></div>
                        <span
                            class="video-frame-name"
                            :title="store.videoEndFrame?.name || 'No image selected'"
                        >
                            {{ store.videoEndFrame?.name || 'No image selected' }}
                        </span>
                        <div class="video-frame-actions">
                            <el-button @click="selectVideoEndFrame">
                                Select Image
                            </el-button>
                            <el-tooltip content="Remove" placement="top">
                                <el-button
                                    class="small-btn"
                                    type="danger"
                                    :icon="Delete"
                                    plain
                                    :disabled="!store.videoEndFrame"
                                    @click="store.clearVideoEndFrame()"
                                />
                            </el-tooltip>
                        </div>
                    </div>
                </div>
                <el-row>
                    <el-col :span="isMobile ? 24 : 12">
                        <form-switch label="ESRGAN Upscale"    prop="enable_hr"   v-model="store.params.enable_hr"    info="Enable upscale with ESRGAN." />
                    </el-col>
                    <el-col :span="isMobile ? 24 : 12">
                        <form-switch label="Send as RefImg"    prop="send_as_refimg"   v-model="store.params.send_as_refimg"  v-if="store.generatorType === 'Img2Img'"  info="Instead of regular Img2Img, send the image as a reference image for edit models." />
                    </el-col>
                </el-row>
                <el-collapse v-model="loraListOpen" class="lora-list-collapse">
                    <el-collapse-item name="lora-list">
                        <template #title>
                            <span class="lora-list-title">LoRAs</span>
                            <span class="lora-list-summary">{{ loraSummary }}</span>
                        </template>
                        <div v-if="loraListLoaded && availableLoras.length === 0" class="lora-list-hint">
                            No LoRAs were returned by the server.
                        </div>
                        <div v-for="(row, index) in store.loraList" :key="index" class="lora-list-row">
                            <el-select v-model="row.lora" class="lora-list-select" filterable placeholder="Select a LoRA">
                                <el-option value="" />
                                <el-option
                                    v-for="lora in availableLoras"
                                    :key="lora.path"
                                    :label="lora.name"
                                    :value="lora.path"
                                />
                            </el-select>
                            <el-input-number v-model="row.multiplier" :step="0.05" :precision="2" controls-position="right" />
                            <el-tooltip content="Remove" placement="top">
                                <el-button :icon="Delete" plain @click="store.removeLoraRow(index)" />
                            </el-tooltip>
                        </div>
                        <div class="lora-list-add">
                            <el-button :icon="Plus" @click="store.addLoraRow()" :disabled="availableLoras.length === 0">
                                Add LoRA
                            </el-button>
                            <el-button :icon="ArrowUp" @click="moveLorasToPrompt" :disabled="loraNamedCount === 0">
                                To Prompt
                            </el-button>
                            <el-button :icon="ArrowDown" @click="moveLorasFromPrompt" :disabled="promptLoraTagCount === 0">
                                From Prompt
                            </el-button>
                        </div>
                    </el-collapse-item>
                </el-collapse>
            </div>
            <div class="main">
                <el-button @click="() => {store.cancelled=true;store.generating=false;store.resetStore();}" class="reset-btn">Reset</el-button>
                <el-button
                    type="primary"
                    class="generate-cancel-btn"
                    :style="store.generating ? 'width: 55%;' : ''"
                    @click="() => store.generateImage(store.generatorType)"
                >
                    <span>
                        Generate {{ store.totalImageCount }} image{{ store.totalImageCount === 1 ? "" : "s" }}
                    </span>
                </el-button>
                <el-button
                    v-if="store.generating"
                    type="danger"
                    class="generate-cancel-btn"
                    style="width: 25%;"
                    :disabled="store.cancelled"
                    @click="() => {
                        store.abortController?.abort();
                        store.cancelled = true;
                        store.generating = false;
                        store.clearQueue();
                        store.clearLastImageGenkey();
                        store.stopProgressPolling();
                    }"
                >Cancel all</el-button>
            </div>
            <div class="image center-horizontal">
                <el-card
                    class="center-both generated-image"
                >
                    <div v-if="!store.generating && store.outputs.length == 0">
                        <CustomCanvas v-if="/Inpainting/.test(store.generatorType)" />
                        <CustomCanvas v-if="/Img2Img/.test(store.generatorType)" />
                    </div>
                    <image-progress
                        :generated="store.outputs.length"
                        :total="store.queue.length"
                        :elapsed="formatEST(store.timer.seconds)"
                        :progress-percentage="store.progressInfo?.percentage"
                        :text-info="store.progressInfo?.textInfo"
                        :current-step="store.progressInfo?.currentStep"
                        :total-steps="store.progressInfo?.totalSteps"
                        :preview-image="store.progressInfo?.previewImage"
                        :generating="store.generating"
                        @show-generated="uiStore.showGeneratedImages = true"
                        v-if="!uiStore.showGeneratedImages && store.generating"
                    />
                    <generated-carousel v-if="uiStore.showGeneratedImages && store.outputs.length !== 0" />
                </el-card>
                <el-link
                    v-if="store.lastImageRecoveryAvailable"
                    class="last-image-recovery"
                    :href="store.lastImageRecoveryUrl"
                    target="_blank"
                    type="primary"
                    @click.prevent="store.openLastImageRecovery()"
                >
                    Recover last generated image
                </el-link>
            </div>
        </el-form>
    </div>
</template>

<style>
:root {
    --sidebar-width: 70px
}

.small-btn {
    padding: 6px 8px;
    height: unset;
}

.generator-types {
    position: fixed;
    height: calc(100vh - 67px);
    top: 67px;
}

.mobile-generator-types {
    width: 100%
}

.generated-image {
    aspect-ratio: 1 / 1;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    padding-top: 20px;
    padding-bottom: 20px;
}

.generated-image > .el-card__body {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
}

.el-collapse, .sidebar-container {
    width: 100%
}

.form {
    padding-left: 20px;
    margin-left: var(--sidebar-width);
}

.main {
    grid-area: main;
    display: flex;
    justify-content: center;
}


.generate-cancel-btn {
    width: 80%;
}

.sidebar {
    grid-area: sidebar;
    max-width: 90%;
}

.reference-images {
    margin: 14px 0;
}

.reference-images-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
}

.reference-images-label {
    flex: 0 0 120px;
    font-size: 14px;
    color: var(--el-text-color-regular);
}

.reference-images-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
}

.reference-images-input {
    display: none;
}

.reference-image-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.reference-image-item {
    display: grid;
    grid-template-columns: 28px 48px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-height: 58px;
    padding: 6px 8px;
    border: 1px solid var(--el-border-color);
    border-radius: 6px;
    background: var(--el-fill-color-blank);
}

.reference-file-item {
    grid-template-columns: 28px minmax(0, 1fr) auto;
}

.reference-image-index {
    font-size: 13px;
    color: var(--el-text-color-secondary);
    text-align: center;
}

.reference-image-thumb {
    width: 48px;
    height: 48px;
    border-radius: 4px;
    border: 1px solid var(--el-border-color-lighter);
    overflow: hidden;
}

.reference-image-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
}

.reference-image-controls {
    display: flex;
    align-items: center;
    gap: 4px;
}

.reference-image-controls .el-button + .el-button {
    margin-left: 0;
}

.reference-image-empty {
    padding: 10px 8px;
    border: 1px dashed var(--el-border-color);
    border-radius: 6px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.lora-list-collapse {
    width: 100%;
    margin: 14px 0;
}

.lora-list-title {
    font-size: 14px;
    font-weight: 600;
}

.lora-list-summary {
    margin-left: 8px;
    font-size: 13px;
    color: var(--el-text-color-secondary);
}

.lora-list-hint {
    padding: 4px 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
}

.lora-list-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
}

.lora-list-select {
    flex: 1;
    min-width: 140px;
}

.lora-list-add {
    padding: 6px 0;
}

.video-frame-selectors {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 14px 0;
}

.video-frame-selector {
    display: grid;
    grid-template-columns: 140px 48px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-height: 58px;
    padding: 6px 8px;
    border: 1px solid var(--el-border-color);
    border-radius: 6px;
    background: var(--el-fill-color-blank);
}

.video-frame-label {
    font-size: 14px;
    color: var(--el-text-color-regular);
}

.video-frame-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: var(--el-text-color-secondary);
}

.video-frame-thumb-empty {
    background: var(--el-fill-color-light);
}

.video-frame-actions {
    display: flex;
    align-items: center;
    gap: 4px;
}

.video-frame-actions .el-button + .el-button {
    margin-left: 0;
}

.image {
    grid-area: image;
    flex-direction: column;
}

.last-image-recovery {
    margin-top: 10px;
    font-size: 13px;
}

.container {
    display: grid;
    height: 75vh;
    grid-template-columns: 50% 50%;
    grid-template-rows: 40px 95%;
    grid-template-areas:
        "sidebar main"
        "sidebar image";
}

@media only screen and (max-width: 1280px) {
    .generated-image > .el-card__body {
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .generated-image {
        width: 90%;
        height: 100%;
        padding-top: 0px;
        padding-bottom: 0px;
    }

    .container {
        display: grid;
        height: auto;
        min-height: 110vh;
        grid-template-rows: minmax(400px, 45vh) max-content auto;
        grid-template-columns: 100%;
        gap: 8px;
        grid-template-areas:
            "image"
            "main"
            "sidebar";
    }

    .sidebar {
        max-width: 100%;
    }

    .reference-images-header {
        align-items: flex-start;
        flex-direction: column;
    }

    .reference-images-label {
        flex-basis: auto;
    }

    .reference-images-actions {
        width: 100%;
        flex-wrap: wrap;
    }

    .video-frame-selector {
        grid-template-columns: 130px 44px minmax(0, 1fr) auto;
    }

    .main {
        flex-wrap: wrap;
        gap: 5px;
    }

    .main > * {
        width: 100% !important;
        margin: 0 !important;
    }

    .reset-btn {
        order: 1;
    }

    .generate-cancel-btn {
        order: 0;
    }
}

@media only screen and (max-width: 768px) {
    .generated-image {
        width: 100%;
        height: 100%;
        padding-top: 0px;
        padding-bottom: 0px;
    }

    .container {
        grid-template-rows: minmax(400px, 50vh) max-content auto;
    }

    .form {
        padding-top: 20px;
        padding-left: 0;
        margin-left: 0;
    }

    .reference-image-item {
        grid-template-columns: 24px 44px minmax(0, 1fr);
    }

    .reference-file-item {
        grid-template-columns: 24px minmax(0, 1fr);
    }

    .reference-image-controls {
        grid-column: 3;
        justify-content: flex-end;
        width: 100%;
    }

    .reference-file-item .reference-image-controls {
        grid-column: 2;
    }

    .reference-image-thumb {
        width: 44px;
        height: 44px;
    }

    .video-frame-selector {
        grid-template-columns: 1fr 44px;
    }

    .video-frame-label {
        grid-column: 1 / -1;
    }

    .video-frame-name {
        min-width: 0;
    }

    .video-frame-actions {
        grid-column: 1 / -1;
        justify-content: flex-end;
        width: 100%;
    }
}

</style>
