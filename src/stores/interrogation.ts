import { validateResponse } from "@/utils/validate";
import { buildApiUrl } from "@/utils/api";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useOptionsStore } from "./options";
import { useUIStore } from "./ui";

export interface InterrogationInfo {
    status?: string;
    id?: string;
    source_image?: string;
}

export const useInterrogationStore = defineStore("interrogate", () => {
    const currentInterrogation = ref<InterrogationInfo>({});
    const interrogating = ref(false);

    async function onError(msg: string) {
        const uiStore = useUIStore();
        uiStore.raiseError(msg, false);
        interrogating.value = false;
        currentInterrogation.value = {};
    }

    async function interrogateImage() {
        const optionsStore = useOptionsStore();
        const { source_image } = currentInterrogation.value;
        if (!source_image) return onError("Failed to get interrogation ID: No image supplied.");
        interrogating.value = true;
        const response = await fetch(buildApiUrl(optionsStore.baseURL, "/sdapi/v1/interrogate"), {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                image: source_image.split(",")[1],
                model: "clip",
            })
        });
        const json: any = await response.json();
        if (!validateResponse(response, json, 200, "Failed to get interrogation", onError)) return;
        currentInterrogation.value.id = json.id;
        currentInterrogation.value.status = json.caption;
    }

    function resetInterrogation() {
        currentInterrogation.value = {};
        interrogating.value = false;
    }

    function getFormStatus() {
        return currentInterrogation.value.status || false;
    }

    return {
        // Variables
        currentInterrogation,
        interrogating,
        // Actions
        interrogateImage,
        getFormStatus,
        resetInterrogation,
    }
})
