<script setup lang="ts">
import { reactive } from 'vue';
import { useGeneratorStore, getNewSeed } from '@/stores/generator';
import {
    type FormRules,
    ElCollapse,
    ElCollapseItem,
    ElForm,
    ElButton,
    ElCard,
    ElMenu,
    ElTooltip,
    ElRow,
    ElCol
} from 'element-plus';
import {
    Comment,
    PictureFilled,
    MagicStick,
    CloseBold,
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
import { useOptionsStore } from '@/stores/options';
import { formatSeconds } from '@/utils/format';

const breakpoints = useBreakpoints(breakpointsTailwind);
const isMobile = breakpoints.smallerOrEqual('md');

const store = useGeneratorStore();
const uiStore = useUIStore();
const canvasStore = useCanvasStore();
const optionsStore = useOptionsStore();

let samplerList = [] as string[];

const availableSamplers = computedAsync(async () => {
    if (samplerList.length === 0) {
        try {
            samplerList = (await (await fetch(`${optionsStore.baseURL.length === 0 ? "." : optionsStore.baseURL}/sdapi/v1/samplers`)).json()).map((el: any) => el.name);
        } catch (e) {
            samplerList = [];
        }
    }
    if (samplerList.length === 0) return [];
    return updateCurrentSampler(samplerList);
})

let schedulerList = [] as string[];

const availableSchedulers = computedAsync(async () => {
    if (schedulerList.length === 0) {
        try {
            schedulerList = (await (await fetch(`${optionsStore.baseURL.length === 0 ? "." : optionsStore.baseURL}/sdapi/v1/schedulers`)).json()).map((el: any) => el.name);
        } catch (e) {
            schedulerList = [];
        }
    }
    if (schedulerList.length === 0) return [];
    return updateCurrentScheduler(schedulerList);
})

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
                <el-collapse v-model="uiStore.activeCollapse" style="margin-bottom: 24px">
                    <el-collapse-item title="Generation Options" name="1">
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
                        <form-select label="Sampler(s)"            prop="samplers"        v-model="store.multiSelect.sampler.selected"     :options="availableSamplers"  info="Multi-select enabled. Heun and DPM2 double generation time per step, but converge twice as fast." multiple v-if="store.multiSelect.sampler.enabled" />
                        <form-select label="Sampler"               prop="sampler"         v-model="store.params.sampler_name"              :options="availableSamplers"  info="Heun and DPM2 double generation time per step, but converge twice as fast." v-else />
                        <form-slider label="Batch Size"            prop="batchSize"       v-model="store.params.n"                         :min="store.minImages"        :max="store.maxImages" />
                        <form-slider label="Steps(s)"              prop="multiSteps"      v-model="store.multiSelect.steps.selected"       :min="store.minSteps"         :max="store.maxSteps"      info="Multi-select enabled. Keep step count between 30 to 50 for optimal generation times. Coherence typically peaks between 60 and 90 steps, with a trade-off in speed." multiple v-if="store.multiSelect.steps.enabled" />
                        <form-slider label="Steps"                 prop="steps"           v-model="store.params.steps"                     :min="store.minSteps"         :max="store.maxSteps"      info="Keep step count between 30 to 50 for optimal generation times. Coherence typically peaks between 60 and 90 steps, with a trade-off in speed." v-else />
                        <form-slider label="Width"                 prop="width"           v-model="store.params.width"                     :min="store.minDimensions"    :max="store.maxDimensions" :step="64"   :change="onDimensionsChange" />
                        <form-slider label="Height"                prop="height"          v-model="store.params.height"                    :min="store.minDimensions"    :max="store.maxDimensions" :step="64"   :change="onDimensionsChange" />
                        <form-slider label="Guidance(s)"           prop="cfgScales"       v-model="store.multiSelect.guidance.selected"    :min="store.minCfgScale"      :max="store.maxCfgScale"   info="Multi-select enabled. Higher values will make the AI respect your prompt more. Lower values allow the AI to be more creative." multiple v-if="store.multiSelect.guidance.enabled" />
                        <form-slider label="Guidance"              prop="cfgScale"        v-model="store.params.cfg_scale"                 :min="store.minCfgScale"      :max="store.maxCfgScale"   :step="0.5"  info="Higher values will make the AI respect your prompt more. Lower values allow the AI to be more creative." v-else />
                        <form-slider label="CLIP Skip(s)"          prop="clipSkips"       v-model="store.multiSelect.clipSkip.selected"    :min="store.minClipSkip"      :max="store.maxClipSkip"   info="Multi-select enabled. Last layers of CLIP to ignore. For most situations this can be left alone." multiple v-if="store.multiSelect.clipSkip.enabled" />
                        <form-slider label="CLIP Skip"             prop="clipSkip"        v-model="store.params.clip_skip"                 :min="store.minClipSkip"      :max="store.maxClipSkip"   info="Last layers of CLIP to ignore. For most situations this can be left alone." v-else />
                        <form-slider label="Init Strength"         prop="denoise"         v-model="store.params.denoising_strength"        :min="store.minDenoise"       :max="store.maxDenoise"    :step="0.01" info="The final image will diverge from the starting image at higher values." v-if="store.sourceGeneratorTypes.includes(store.generatorType)" />
                        <form-slider label="Video Frames"          prop="frames"          v-model="store.params.frames"                    :min="store.minFrames"        :max="store.maxFrames"     info="Number of consecutive video frames to generate (Video models only). Max 80 frames, about 5 seconds of video."/>
                        <form-select label="Scheduler"             prop="scheduler"       v-model="store.params.scheduler"            :options="availableSchedulers" info="Experimental! KoboldCpp only, allows you to use a different scheduler. Leave as default otherwise."/>
                        <div>
                        <span style="height: 100%;font-size: 14px;">Reference Image: <br>(Photomaker/Kontext) </span>
                        <input class="el-button"
                        type="file"
                        id="extra_image_input"
                        @change="store.setExtraImage($event)"
                        accept="image/*" multiple
                        />
                        <button @click="store.clearExtraImage()" class="el-button">Clear Image</button>
                        <el-row>
                            <el-col :span="isMobile ? 24 : 12">
                                <form-switch label="ESRGAN Upscale"    prop="enable_hr"   v-model="store.params.enable_hr"    info="Enable upscale with ESRGAN." />
                            </el-col>
                            <el-col :span="isMobile ? 24 : 12">
                                <form-switch label="Send as RefImg"    prop="send_as_refimg"   v-model="store.params.send_as_refimg"  v-if="store.sourceGeneratorTypes.includes(store.generatorType)"  info="Instead of regular Img2Img, send the image as a reference image for edit models." />
                            </el-col>
                        </el-row>
                        </div>
                        <h3 style="margin: 16px 0 4px 0">Multi Select</h3>
                        <el-row>
                            <el-col :span="isMobile ? 24 : 12">
                                <form-switch label="Multi Sampler"      prop="multiSamplerSwitch"  v-model="store.multiSelect.sampler.enabled" />
                            </el-col>
                            <el-col :span="isMobile ? 24 : 12">
                                <form-switch label="Multi Guidance"     prop="multiGuidanceSwitch" v-model="store.multiSelect.guidance.enabled" />
                            </el-col>
                            <el-col :span="isMobile ? 24 : 12">
                                <form-switch label="Multi CLIP Skip"    prop="multiClipSkipSwitch" v-model="store.multiSelect.clipSkip.enabled" />
                            </el-col>
                            <el-col :span="isMobile ? 24 : 12">
                                <form-switch label="Multi Steps"        prop="multiStepsSwitch"    v-model="store.multiSelect.steps.enabled" />
                            </el-col>
                        </el-row>
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
                        store.cancelled = true;
                        store.generating = false;
                        store.clearQueue();
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
                        @show-generated="uiStore.showGeneratedImages = true"
                        v-if="!uiStore.showGeneratedImages && store.generating"
                    />
                    <generated-carousel v-if="uiStore.showGeneratedImages && store.outputs.length !== 0" />
                </el-card>
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

.image {
    grid-area: image;
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
        width: 80%;
        height: 100%;
        padding-top: 0px;
        padding-bottom: 0px;
    }

    .container {
        display: grid;
        height: 110vh;
        grid-template-rows: minmax(400px, 45vh) 65px 60%;
        grid-template-columns: 100%;
        gap: 10px;
        grid-template-areas:
            "image"
            "main"
            "sidebar";
    }

    .sidebar {
        max-width: 100%;
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
        grid-template-rows: minmax(400px, 50vh) 65px 60%;
    }

    .form {
        padding-top: 20px;
        padding-left: 0;
        margin-left: 0;
    }
}

</style>
