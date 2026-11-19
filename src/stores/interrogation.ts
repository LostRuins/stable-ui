import { validateResponse } from "@/utils/validate";
import { fetchApi } from "@/utils/api";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useUIStore } from "./ui";

export interface InterrogationInfo {
    status?: string;
    id?: string;
    source_image?: string;
}

export const useInterrogationStore = defineStore("interrogate", () => {
    const currentInterrogation = ref<InterrogationInfo>({});
    const interrogating = ref(false);

    function onError(msg: string) {
        resetInterrogation();
        useUIStore().raiseError(msg, false);
    }

    async function interrogateImage() {
        const { source_image } = currentInterrogation.value;
        if (!source_image) return onError("Failed to get interrogation ID: No image supplied.");
        interrogating.value = true;
        try {
            const response = await fetchApi("/sdapi/v1/interrogate", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    image: source_image.split(",")[1],
                    model: "clip",
                })
            });
            if (response.status === 401 || response.status === 403) {
                return onError(`The server denied the interrogation request (HTTP ${response.status}). Check the API key in Options.`);
            }
            const json = await response.json().catch(() => null);
            if (json === null) {
                return onError(response.ok
                    ? "The server returned an invalid interrogation response."
                    : `The interrogation request failed (HTTP ${response.status}).`);
            }
            if (!validateResponse(response, json, 200, "Failed to get interrogation", onError)) return;
            currentInterrogation.value.id = json.id;
            currentInterrogation.value.status = json.caption;
            interrogating.value = false;
        } catch {
            onError("Could not complete the interrogation request.");
        }
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
