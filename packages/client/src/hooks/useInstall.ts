import { useMutation, useQueryClient } from "@tanstack/react-query";
import { installFromSource, uploadAndInstall, uninstallAddon } from "../api/client.js";

export function useInstallAddon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: installFromSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
}

export function useUploadAddon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ containerId, file }: { containerId: string; file: File }) =>
      uploadAndInstall(containerId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
}

export function useUninstallAddon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      containerId,
      installationId,
    }: {
      containerId: string;
      installationId: number;
    }) => uninstallAddon(containerId, installationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
}
