import { ref, watch, type Ref } from "vue";
import { db } from "@/utils/db";
import { releaseUrl, retainUrl } from "@/utils/blobCache";

/** Lazily retain an output's primary image URL while it is rendered. */
export function useOutputBlobUrl(
    outputId: Readonly<Ref<number | undefined>>,
    enabled: Readonly<Ref<boolean>>,
): Readonly<Ref<string>> {
    const objectUrl = ref("");

    watch(
        [outputId, enabled],
        async ([id, isEnabled], _oldValues, onCleanup) => {
            objectUrl.value = "";
            if (id === undefined || !isEnabled) return;

            let retained = false;
            let cancelled = false;
            onCleanup(() => {
                cancelled = true;
                if (retained) releaseUrl(id, "image");
            });

            try {
                const row = await db.outputs.get(id);
                if (!row) return;

                const nextUrl = retainUrl(id, "image", row.image);
                retained = true;
                if (cancelled) {
                    releaseUrl(id, "image");
                    retained = false;
                    return;
                }
                objectUrl.value = nextUrl;
            } catch (error) {
                console.warn(`Failed to prepare output ${id} for display:`, error);
            }
        },
        { immediate: true },
    );

    return objectUrl;
}
