/**
 * Storage Checker Live — Master E2E Test Runner
 * tests/e2e/runner.ts
 *
 * Discovers and executes tests across all tiers (Tier 1..Tier 4) via native node:test,
 * emitting colored console progress, JUnit XML (test-results.xml), and JSON summary (test-results.json).
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// 1. CLI Options & Tier Definitions
// ============================================================================

export interface RunnerOptions {
  tier: '1' | '2' | '3' | '4' | 'all' | 'harness';
  filter?: RegExp | string;
  reporter: 'spec' | 'junit' | 'json' | 'all';
  outputDir: string;
  mock: boolean;
  bail: boolean;
  timeoutMs: number;
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  stack?: string;
  skipped?: boolean;
}

export interface SuiteResult {
  file: string;
  relativePath: string;
  tier: string;
  durationMs: number;
  passed: boolean;
  tests: TestCaseResult[];
}

export interface RunSummary {
  timestamp: string;
  runner: string;
  platform: string;
  nodeVersion: string;
  durationMs: number;
  options: Partial<RunnerOptions>;
  counts: {
    totalSuites: number;
    passedSuites: number;
    failedSuites: number;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    todo: number;
  };
  suites: SuiteResult[];
}

// ============================================================================
// 2. Argument Parser Helper
// ============================================================================

export function parseCliArgs(argv: string[]): RunnerOptions {
  const options: RunnerOptions = {
    tier: 'all',
    reporter: 'all',
    outputDir: process.cwd(),
    mock: false,
    bail: false,
    timeoutMs: 30_000,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--tier=')) {
      const val = arg.split('=')[1].toLowerCase();
      if (['1', '2', '3', '4', 'all', 'harness'].includes(val)) {
        options.tier = val as any;
      }
    } else if (arg.startsWith('--filter=')) {
      options.filter = arg.split('=')[1];
    } else if (arg.startsWith('--reporter=')) {
      const val = arg.split('=')[1].toLowerCase();
      if (['spec', 'junit', 'json', 'all'].includes(val)) {
        options.reporter = val as any;
      }
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = path.resolve(arg.split('=')[1]);
    } else if (arg === '--mock') {
      options.mock = true;
    } else if (arg === '--bail') {
      options.bail = true;
    } else if (arg.startsWith('--timeout=')) {
      options.timeoutMs = parseInt(arg.split('=')[1], 10) || 30_000;
    }
  }

  return options;
}

// ============================================================================
// 3. Test File Discovery
// ============================================================================

export function discoverTestFiles(projectRoot: string, tier: RunnerOptions['tier'], filter?: RegExp | string): string[] {
  const e2eDir = path.join(projectRoot, 'tests', 'e2e');
  if (!fs.existsSync(e2eDir)) {
    return [];
  }

  const candidateDirs: { tierName: string; dir: string }[] = [];

  if (tier === 'harness' || tier === 'all') {
    candidateDirs.push({ tierName: 'harness', dir: path.join(e2eDir, 'harness') });
  }
  if (tier === '1' || tier === 'all') {
    candidateDirs.push({ tierName: 'tier1', dir: path.join(e2eDir, 'tier1') });
  }
  if (tier === '2' || tier === 'all') {
    candidateDirs.push({ tierName: 'tier2', dir: path.join(e2eDir, 'tier2') });
  }
  if (tier === '3' || tier === 'all') {
    candidateDirs.push({ tierName: 'tier3', dir: path.join(e2eDir, 'tier3') });
  }
  if (tier === '4' || tier === 'all') {
    candidateDirs.push({ tierName: 'tier4', dir: path.join(e2eDir, 'tier4') });
  }

  const collected: string[] = [];

  function walk(currentDir: string): void {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.js'))) {
        collected.push(fullPath);
      }
    }
  }

  for (const { dir } of candidateDirs) {
    walk(dir);
  }

  // Filter if pattern specified
  let filtered = collected;
  if (filter) {
    const reg = typeof filter === 'string' ? new RegExp(filter, 'i') : filter;
    filtered = collected.filter((f) => reg.test(f));
  }

  return filtered.sort((a, b) => a.localeCompare(b));
}

// ============================================================================
// 4. JUnit XML & JSON Summary Builders
// ============================================================================

export function buildJunitXml(summary: RunSummary): string {
  const escapeXml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const totalTimeSec = (summary.durationMs / 1000).toFixed(3);
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="Storage Checker Live E2E" time="${totalTimeSec}" tests="${summary.counts.totalTests}" failures="${summary.counts.failed}" errors="0" skipped="${summary.counts.skipped}">\n`;

  for (const suite of summary.suites) {
    const suiteTimeSec = (suite.durationMs / 1000).toFixed(3);
    const suiteFailures = suite.tests.filter((t) => !t.passed && !t.skipped).length;
    xml += `  <testsuite name="${escapeXml(suite.relativePath)}" tests="${suite.tests.length}" failures="${suiteFailures}" errors="0" skipped="0" time="${suiteTimeSec}">\n`;

    for (const test of suite.tests) {
      const testTimeSec = (test.durationMs / 1000).toFixed(3);
      xml += `    <testcase name="${escapeXml(test.name)}" classname="${escapeXml(suite.relativePath)}" time="${testTimeSec}">\n`;
      if (!test.passed && !test.skipped) {
        xml += `      <failure message="${escapeXml(test.error || 'Test failed')}">${escapeXml(test.stack || '')}</failure>\n`;
      } else if (test.skipped) {
        xml += `      <skipped/>\n`;
      }
      xml += `    </testcase>\n`;
    }

    xml += `  </testsuite>\n`;
  }

  xml += `</testsuites>\n`;
  return xml;
}

// ============================================================================
// 5. Master Runner Orchestration
// ============================================================================

export async function runMasterRunner(options: RunnerOptions): Promise<RunSummary> {
  const projectRoot = process.cwd();
  if (options.mock) {
    process.env.APP_DRIVER_MOCK = 'true';
  }

  const files = discoverTestFiles(projectRoot, options.tier, options.filter);

  console.log('\n===============================================================');
  console.log('             Storage Checker Live — Master E2E Runner');
  console.log('===============================================================');
  console.log(`Execution Mode : ${options.mock ? 'MOCK (Contract Stub)' : 'NATIVE (Compiled Binary)'}`);
  console.log(`Target Tier    : ${options.tier.toUpperCase()}`);
  console.log(`Suites Matched : ${files.length}`);
  console.log(`Output Folder  : ${options.outputDir}`);
  console.log('---------------------------------------------------------------\n');

  if (files.length === 0) {
    console.warn('⚠️  No matching test files found for execution.');
    const emptySummary: RunSummary = {
      timestamp: new Date().toISOString(),
      runner: 'node:test + tsx',
      platform: process.platform,
      nodeVersion: process.version,
      durationMs: 0,
      options,
      counts: {
        totalSuites: 0,
        passedSuites: 0,
        failedSuites: 0,
        totalTests: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        todo: 0,
      },
      suites: [],
    };
    return emptySummary;
  }

  const startTime = Date.now();
  const summary: RunSummary = {
    timestamp: new Date().toISOString(),
    runner: 'node:test + tsx',
    platform: process.platform,
    nodeVersion: process.version,
    durationMs: 0,
    options,
    counts: {
      totalSuites: files.length,
      passedSuites: 0,
      failedSuites: 0,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      todo: 0,
    },
    suites: [],
  };

  const currentSuiteMap = new Map<string, SuiteResult>();

  for (const file of files) {
    const rel = path.relative(projectRoot, file);
    const tierMatch = rel.match(/tier(\d)/i);
    const suiteRes: SuiteResult = {
      file,
      relativePath: rel,
      tier: tierMatch ? `Tier ${tierMatch[1]}` : 'Harness',
      durationMs: 0,
      passed: true,
      tests: [],
    };
    currentSuiteMap.set(file, suiteRes);
    summary.suites.push(suiteRes);
  }

  // Execute test stream via Node.js native run()
  const stream = run({
    files,
    timeout: options.timeoutMs,
  });

  // Pipe to spec reporter if requested
  if (options.reporter === 'spec' || options.reporter === 'all') {
    stream.compose(spec).pipe(process.stdout);
  }

  // Tap into events for reporting catalog
  stream.on('data', (event: any) => {
    if (event.type === 'test:pass') {
      const file = event.data?.file;
      const suite = file ? currentSuiteMap.get(file) : null;
      summary.counts.totalTests++;
      summary.counts.passed++;

      if (suite) {
        suite.tests.push({
          name: event.data.name,
          passed: true,
          durationMs: event.data.details?.duration_ms || 0,
        });
      }
    } else if (event.type === 'test:fail') {
      const file = event.data?.file;
      const suite = file ? currentSuiteMap.get(file) : null;
      summary.counts.totalTests++;
      summary.counts.failed++;

      if (suite) {
        suite.passed = false;
        suite.tests.push({
          name: event.data.name,
          passed: false,
          durationMs: event.data.details?.duration_ms || 0,
          error: event.data.details?.error?.message || 'Assertion failed',
          stack: event.data.details?.error?.stack,
        });
      }
    }
  });

  await new Promise((resolve) => stream.on('end', resolve));

  summary.durationMs = Date.now() - startTime;
  summary.counts.passedSuites = summary.suites.filter((s) => s.passed).length;
  summary.counts.failedSuites = summary.suites.filter((s) => !s.passed).length;

  // Write JUnit XML
  if (options.reporter === 'junit' || options.reporter === 'all') {
    const xml = buildJunitXml(summary);
    const xmlPath = path.join(options.outputDir, 'test-results.xml');
    fs.writeFileSync(xmlPath, xml, 'utf8');
    console.log(`📄 JUnit XML report saved to: ${xmlPath}`);
  }

  // Write JSON Summary
  if (options.reporter === 'json' || options.reporter === 'all') {
    const jsonPath = path.join(options.outputDir, 'test-results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`📄 JSON summary report saved to: ${jsonPath}`);
  }

  return summary;
}

// ============================================================================
// 6. Direct CLI Invocation Check
// ============================================================================

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseCliArgs(process.argv);
  runMasterRunner(options)
    .then((summary) => {
      process.exit(summary.counts.failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal Test Runner Error:', err);
      process.exit(1);
    });
}
