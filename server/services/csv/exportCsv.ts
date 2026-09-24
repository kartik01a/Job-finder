import fs from "node:fs";
import path from "node:path";

export type CsvJob = {
  id: number;
  score: number;
  company: string;
  title: string;
  salary: string;
  applyUrl: string;
  jobUrl: string;
  workMode: string;
  status: string;
  postedAt: number | null;
  firstSeenAt: number;
};

const COLUMNS = [
  "id",
  "score",
  "company",
  "job_title",
  "salary",
  "apply_url",
  "job_url",
  "work_mode",
  "status",
] as const;

export function jobsToCsv(jobs: CsvJob[]): string {
  const sorted = [...jobs].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftTime = left.postedAt ?? left.firstSeenAt;
    const rightTime = right.postedAt ?? right.firstSeenAt;
    return rightTime - leftTime;
  });
  const lines = [COLUMNS.join(",")];
  for (const job of sorted) {
    lines.push(
      [
        job.id,
        job.score,
        job.company,
        job.title,
        job.salary,
        job.applyUrl,
        job.jobUrl,
        job.workMode,
        job.status,
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function writeJobsCsv(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function csvField(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
