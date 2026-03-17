export type ParsedAgentLogLine = {
  raw: string;
  timestamp: string | null;
  agent: string | null;
  tool: string | null;
  message: string;
};

const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T[^ ]+\s+/;
const AGENT_PREFIX = /^\[([^\]]+)\](?:\s+\[Tool:\s*([^\]]+)\])?\s*(.*)$/;

export function formatAgentLog(params: {
  agent: string;
  message: string;
  tool?: string;
}) {
  const toolPrefix = params.tool ? ` [Tool: ${params.tool}]` : "";
  return `[${params.agent}]${toolPrefix} ${params.message}`;
}

export function stripTimestamp(line: string) {
  return line.replace(TIMESTAMP_PREFIX, "");
}

export function parseAgentLogLine(line: string): ParsedAgentLogLine {
  const timestampMatch = line.match(TIMESTAMP_PREFIX);
  const timestamp = timestampMatch?.[0]?.trim() ?? null;
  const content = stripTimestamp(line);
  const match = content.match(AGENT_PREFIX);

  if (!match) {
    return {
      raw: line,
      timestamp,
      agent: null,
      tool: null,
      message: content,
    };
  }

  return {
    raw: line,
    timestamp,
    agent: match[1]?.trim() ?? null,
    tool: match[2]?.trim() ?? null,
    message: match[3]?.trim() ?? "",
  };
}

export function collectAgentActivity(logs: string[]) {
  const activity = new Map<
    string,
    {
      agent: string;
      tool: string | null;
      message: string;
      timestamp: string | null;
    }
  >();

  for (const log of logs) {
    const parsed = parseAgentLogLine(log);
    if (!parsed.agent) {
      continue;
    }

    activity.set(parsed.agent, {
      agent: parsed.agent,
      tool: parsed.tool,
      message: parsed.message,
      timestamp: parsed.timestamp,
    });
  }

  return [...activity.values()];
}
