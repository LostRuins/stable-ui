<script setup lang="ts">
import { ElProgress, ElIcon } from 'element-plus';
import { Right } from '@element-plus/icons-vue';
import { useEllipsis } from '@/utils/useEllipsis';

const { ellipsis } = useEllipsis();

const truncate = (text: string | null | undefined, maxLen: number) => {
    if (!text) return "";
    return text.length > maxLen ? text.slice(0, maxLen) + "\u2026" : text;
};

defineProps<{
    generated?: number;
    total?: number;
    elapsed?: string;
    progressPercentage?: number;
    textInfo?: string | null;
    currentStep?: number;
    totalSteps?: number;
    previewImage?: string | null; // Expects raw base64 string
    generating?: boolean;
}>();

defineEmits(["showGenerated"]);
</script>

<template>
    <div style="text-align: center;">

        <div class="batch-text" v-if="generating && total && total > 1">
            Image {{ (generated ?? 0) + 1 }} of {{ total }}
        </div>

        <el-progress
            type="circle"
            :percentage="progressPercentage ?? (100 * (generated ?? 0) / (total ?? 1))"
            :width="200"
        >
            <template #default>
                <!-- If we have step data, show step count inside the circle -->
                <span v-if="progressPercentage !== undefined && progressPercentage > 0" class="step-text">
                    {{ currentStep ?? 0 }} / {{ totalSteps ?? 0 }}
                </span>
                <!-- Fallback to batch count if no step data is available -->
                <span v-else>{{ generated ?? 0 }} / {{ total ?? 1 }}</span>
            </template>
        </el-progress>

        <div @click="$emit('showGenerated')" v-if="generated" class="view-images">
            <span>View image{{ (total ?? 1) === 1 ? "" : "s" }}</span>
            <el-icon><Right /></el-icon>
        </div>

        <div class="gen-text">
            <span v-if="generated !== undefined && total !== undefined && generated === total && generated > 0">All done!</span>
            <span v-else-if="textInfo">{{ truncate(textInfo, 60) }}</span>
            <span v-else>Generating{{ellipsis}}{{'&nbsp;'.repeat(3 - ellipsis.length)}}<br><sup>{{ elapsed }}</sup></span>
        </div>
        <div v-if="previewImage" class="preview-container">
            <img
                :src="`data:image/png;base64,${previewImage}`"
                class="preview-img"
                alt="Generation Preview"
            />
        </div>

    </div>
</template>

<style scoped>
.batch-text {
    font-size: 14px;
    color: var(--el-color-info);
    margin-bottom: 8px;
    font-weight: 500;
}

.step-text {
    font-weight: 500;
}

.preview-container {
    margin-top: 12px;
    display: flex;
    justify-content: center;
}

.preview-img {
    max-width: 200px;
    max-height: 200px;
    min-width: 64px;
    min-height: 64px;
    width: auto;
    height: auto;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    border: 1px solid var(--el-border-color-lighter);
    /* Smooth fade-in so the image doesn't harshly pop */
    animation: fadeIn 0.2s ease-in-out;
}

@keyframes fadeIn {
    from { opacity: 0.6; }
    to { opacity: 1; }
}

.view-images, .gen-text {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--el-color-info);
    font-weight: 500;
    margin-top: 8px;
    gap: 8px;
}

.gen-text {
    font-weight: 400;
    min-height: 40px; /* Prevents layout jump when text changes */
}

.view-images:hover {
    cursor: pointer;
    text-decoration: underline;
}
</style>
