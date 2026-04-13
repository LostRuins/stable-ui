<script setup lang="ts">
import {
    ElForm,
    ElFormItem,
    ElInput,
    ElButton,
    type UploadFile,
    ElIcon,
    ElUpload,
    ElTabs,
    ElTabPane,
    ElMessage,
} from 'element-plus';
import {
    UploadFilled,
    Download
} from '@element-plus/icons-vue';
import { useOptionsStore } from '@/stores/options';
import type { BasicColorSchema } from '@vueuse/core';
import FormSlider from '../components/FormSlider.vue';
import FormSelect from '../components/FormSelect.vue';
import FormRadio from '../components/FormRadio.vue';
import { ref } from 'vue';
import { useOutputStore } from '@/stores/outputs';
import { downloadMultipleImages } from '@/utils/download';
import { db } from '@/utils/db';
import { useGeneratorStore } from '@/stores/generator';

const store = useOptionsStore();
const outputsStore = useOutputStore();
const generatorStore = useGeneratorStore();

interface ColorModeOption {
    value: BasicColorSchema;
    label: string;
}

const options: ColorModeOption[] = [
    {
        value: 'dark',
        label: 'Dark',
    }, {
        value: 'light',
        label: 'Light',
    }, {
        value: 'auto',
        label: 'Auto',
    }
]

const fileList = ref([]);
const upload = ref();
const downloading = ref(false);
const downloaded = ref(0);

async function handleChange(uploadFile: UploadFile) {
    outputsStore.importFromZip(uploadFile);
    upload.value!.clearFiles();
}

async function bulkDownload() {
    ElMessage({
        message: `Downloading ${outputsStore.outputsLength} image(s)... (this may take a while)`,
        type: 'info',
    })
    downloading.value = true;
    downloaded.value = 0;

    const selectedOutputs = await db.outputs.toCollection().primaryKeys();
    await downloadMultipleImages(selectedOutputs, false, () => { downloaded.value++ });

    downloading.value = false;
    downloaded.value = 0;
}
</script>

<template>
    <h1>Options</h1>
    <el-form
        label-position="top"
        :model="store.options"
        @submit.prevent
    >
        <el-tabs type="border-card" style="min-height: 50vh;">
            <el-tab-pane label="🖨️ Generation">
                <h2>Generation Options</h2>
                <el-form-item label="Base URL">
                    <el-input class="apikey" prop="baseURL" v-model="store.baseURL" />
                </el-form-item>
                <h3>Parameter Controls</h3>
                <div v-for="(item, key) in generatorStore.multiSelect" :key="key" >
                    <form-radio :label="item.name" prop="pageless" v-model="item.state" :options="item.allowedStates ?? []" />
                </div>
                <form-radio  label="Allow Larger Params" prop="pageless" v-model="store.allowLargerParams" :options="['Enabled', 'Disabled']" />
                <form-radio  label="Video Gen: Request AVI download" prop="pageless" v-model="store.alsoRequestAvi" :options="['Enabled', 'Disabled']" />
            </el-tab-pane>
            <el-tab-pane label="📷 Images">
                <h2>Image Options</h2>
                <form-slider label="Images Per Page" prop="pageSize" v-model="store.pageSize" :min="10" :max="50" :step="5" :disabled="store.pageless === 'Enabled'" />
                <form-radio  label="Pageless Format" prop="pageless" v-model="store.pageless" :options="['Enabled', 'Disabled']" />
                <form-radio  label="Carousel Auto Cycle" prop="autoCarousel" v-model="store.autoCarousel" :options="['Enabled', 'Disabled']" />
                <form-radio  label="Image Download Format" prop="downloadType" v-model="store.imageDownloadType" :options="['PNG', 'JPG', 'WEBP', 'GIF']" />
                <el-form-item label="Export Images (ZIP File)">
                    <el-button :icon="Download" @click="bulkDownload()" v-if="!downloading">Download {{outputsStore.outputsLength}} image(s)</el-button>
                    <el-button :icon="Download" disabled v-else>Downloading... ({{downloaded}} / {{outputsStore.outputsLength}} image(s))</el-button>
                </el-form-item>
                <el-form-item label="Import Images (ZIP File)">
                    <el-upload
                        drag
                        ref="upload"
                        :auto-upload="false"
                        @change="handleChange"
                        :file-list="fileList"
                        :limit="1"
                        multiple
                    >
                        <el-icon :size="100"><upload-filled /></el-icon>
                        <div>Drop file here OR <em>click to upload</em></div>
                    </el-upload>
                </el-form-item>
            </el-tab-pane>
            <el-tab-pane label="⚙️ General">
                <h2>General Options</h2>
                <form-select label="Color Scheme" prop="colorScheme" v-model="store.options.colorMode" :options="options" />
            </el-tab-pane>
        </el-tabs>
    </el-form>
</template>

<style scoped>
.anon {
    width: 80px
}

.el-tab-pane {
    max-width: 600px;
}

h2 {
    margin-top: 0
}

.apikey {
    width: calc(100% - 80px)
}

@media only screen and (max-width: 1000px) {
    .anon {
        width: 80px
    }

    .apikey {
        width: 100%
    }
}
</style>
