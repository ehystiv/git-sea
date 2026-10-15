import { useMutation } from "@tanstack/react-query";
import { commands, type RepoInfo } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";

export function useOpenRepo() {
  return useMutation<RepoInfo, CommandError, string>({
    mutationFn: async (path) => {
      const result = await commands.openRepo(path);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}
