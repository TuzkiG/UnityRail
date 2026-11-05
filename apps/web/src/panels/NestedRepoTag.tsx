import { RiGitRepositoryLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";

export function NestedRepoTag({ repo, submodule = false }: { repo?: string; submodule?: boolean }) {
	const t = useT();
	const label = submodule ? t("changes.section.submodule") : (repo ?? t("changes.nestedRepo.tag"));
	return (
		<span
			data-testid={submodule ? "submodule-tag" : "nested-repo-tag"}
			title={
				repo && !submodule ? t("changes.nestedRepo.tooltip", { repo }) : t("changes.nestedRepo.tag")
			}
			className="inline-flex min-w-0 max-w-120 shrink-0 items-center gap-2 rounded-sm bg-control-bg px-4 py-2 tr-text-metadata text-text-muted"
		>
			<RiGitRepositoryLine className="size-12 shrink-0" aria-hidden />
			<span className="min-w-0 truncate">{label}</span>
		</span>
	);
}
