<script setup lang="ts">
import { computed } from 'vue';
import { ElImage } from 'element-plus';
import { useOutputBlobUrl } from '@/utils/useOutputBlobUrl';

const props = defineProps<{
    outputId: number;
    type: "image" | "video";
    active: boolean;
}>();

const emit = defineEmits<{
    (event: 'open'): void;
}>();

const outputId = computed(() => props.outputId);
const active = computed(() => props.active);
const mediaUrl = useOutputBlobUrl(outputId, active);
</script>

<template>
    <video
        v-if="type === 'video' && mediaUrl"
        :src="mediaUrl"
        controls
        style="max-width: 100%; height: 100%;"
    />
    <el-image
        v-else-if="type === 'image' && mediaUrl"
        :src="mediaUrl"
        style="width: 100%; height: 100%;"
        fit="scale-down"
        @click="emit('open')"
    />
</template>
