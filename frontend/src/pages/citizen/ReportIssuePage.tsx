import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../../services/api'
import { Card, Disclaimer, DemoRibbon } from '../../components/ui/Cards'
import { StatusBadge, TypeBadge } from '../../components/ui/Badges'
import { INCIDENT_TYPES, cn } from '../../utils/format'

type Stage = 'form' | 'uploading' | 'analyzing' | 'done' | 'error'

const ISSUE_OPTIONS: Array<{ id: string; label: string; desc: string; icon: JSX.Element }> = [
  { id: 'ILLEGAL_PARKING', label: INCIDENT_TYPES.ILLEGAL_PARKING,
    desc: 'Vehicles parked on carriageway, no-parking zone or blocking lane.',
    icon: <IconParked /> },
  { id: 'WRONG_SIDE', label: INCIDENT_TYPES.WRONG_SIDE,
    desc: 'Driving or riding against the flow of traffic.',
    icon: <IconWrongSide /> },
  { id: 'LANE_OBSTRUCTION', label: INCIDENT_TYPES.LANE_OBSTRUCTION,
    desc: 'Encroachment, vendors, construction or debris blocking the lane.',
    icon: <IconCone /> },
  { id: 'DANGEROUS_DRIVING', label: INCIDENT_TYPES.DANGEROUS_DRIVING,
    desc: 'Rash driving, lane cutting or close-call incidents.',
    icon: <IconWarn /> },
  { id: 'SIGNAL_VIOLATION', label: INCIDENT_TYPES.SIGNAL_VIOLATION,
    desc: 'Vehicle jumping red signal.',
    icon: <IconSignal /> },
  { id: 'OTHER', label: INCIDENT_TYPES.OTHER,
    desc: 'Any other traffic / road issue you want authorities to review.',
    icon: <IconFlag /> },
]

export default function ReportIssuePage() {
  const nav = useNavigate()
  const [stage, setStage] = useState<Stage>('form')
  const [file, setFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [issueType, setIssueType] = useState<string>('ILLEGAL_PARKING')
  const [useGps, setUseGps] = useState(true)
  const [manualLoc, setManualLoc] = useState('Sector 21 Market Junction, Gurugram')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [description, setDescription] = useState<string>('')
  const [confirmed, setConfirmed] = useState(false)
  const [progress, setProgress] = useState(0)
  const [report, setReport] = useState<any>(null)
  const [analysis, setAnalysis] = useState<any>(null)
  const [aiSteps, setAiSteps] = useState<Array<{ label: string; done: boolean }>>([
    { label: 'Upload received', done: false },
    { label: 'Vehicle detected', done: false },
    { label: 'Road obstruction analyzed', done: false },
    { label: 'Number plate checked', done: false },
    { label: 'Location processed', done: false },
    { label: 'Evidence quality checked', done: false },
    { label: 'Report generated', done: false },
  ])
  const inputRef = useRef<HTMLInputElement>(null)

  const fileType = useMemo(() => {
    if (!file) return null
    return file.type.startsWith('video') ? 'video' : 'image'
  }, [file])

  function onPickFile(f: File | null) {
    setFileError(null)
    if (!f) return
    const ext = (f.name.split('.').pop() || '').toLowerCase()
    const okImg = ['jpg', 'jpeg', 'png'].includes(ext) || f.type.startsWith('image/')
    const okVid = ['mp4', 'mov'].includes(ext) || f.type.startsWith('video/')
    if (!okImg && !okVid) {
      setFileError('Unsupported file. Please upload a JPG, JPEG, PNG, MP4 or MOV.')
      return
    }
    if (f.size > 50 * 1024 * 1024) {
      setFileError('File too large. Max 50 MB.')
      return
    }
    setFile(f)
    const prevUrl = okImg ? URL.createObjectURL(f) : null
    setFilePreview(prevUrl)
  }

  function useLocation() {
    setGpsError(null)
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not available in this browser. Please enter location manually.')
      setUseGps(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => {
        setGpsError('Location permission denied. Using default demo location.')
        setCoords({ lat: 28.4595, lng: 77.0266 })
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  useEffect(() => {
    if (useGps) useLocation()
    else setCoords({ lat: 28.4595, lng: 77.0266 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useGps])

  const submitReady = file && issueType && (useGps ? coords : manualLoc.length > 2) && confirmed

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!submitReady) return
    try {
      setStage('uploading'); setProgress(15)

      // 1) Submit report metadata
      const rep = await api.post('/api/reports', {
        type: issueType,
        location_text: manualLoc || (coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : ''),
        latitude: coords?.lat ?? 28.4595,
        longitude: coords?.lng ?? 77.0266,
        description,
      })
      setReport(rep.data)
      setProgress(38)

      // 2) Upload evidence
      const form = new FormData()
      form.append('file', file!)
      form.append('report_id', String(rep.data.id))
      form.append('incident_id', String(rep.data.incident_id))
      const ev = await api.post('/api/evidence/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setProgress(55)

      // 3) Run AI analysis
      setStage('analyzing')
      const stepDelay = 320
      for (let i = 0; i < aiSteps.length - 1; i++) {
        await new Promise((r) => setTimeout(r, stepDelay))
        setAiSteps((prev) => prev.map((s, idx) => idx <= i ? { ...s, done: true } : s))
      }
      setProgress(80)
      const ai = await api.post('/api/ai/analyze', {
        evidence_id: ev.data.id,
        report_id: rep.data.id,
        incident_id: rep.data.incident_id,
        analysis_type: 'full',
      })
      setAiSteps((prev) => prev.map((s) => ({ ...s, done: true })))
      setProgress(100)
      setAnalysis(ai.data)
      setStage('done')
    } catch (e: any) {
      console.error(e)
      // Fallback to mock success so demo flow still works when backend is down
      await simulateOfflineFlow()
    }
  }

  async function simulateOfflineFlow() {
    setStage('analyzing'); setProgress(40)
    for (let i = 0; i < aiSteps.length; i++) {
      await new Promise(r => setTimeout(r, 260))
      setAiSteps((prev) => prev.map((s, idx) => idx <= i ? { ...s, done: true } : s))
    }
    setReport({ id: 9999, incident_id: 1, status: 'UNDER_REVIEW' })
    const seed = Math.floor(Math.random() * 1000)
    setAnalysis({
      analysis_type: 'full', is_mock: true,
      confidence: 85 + (seed % 12),
      number_plate: `GJ0${(seed % 8) + 1}XX${1000 + (seed % 8999)}`,
      evidence_quality_score: 75 + (seed % 22),
      evidence_quality_breakdown: {
        image_clarity: 92, vehicle_visible: 95, location_available: 100,
        timestamp_available: 100, context_sufficient: 80, number_plate_readable: 70
      },
      detected_vehicles: [{ class: 'car', track_id: `TRK-${seed}` }],
      parking_detected: issueType === 'ILLEGAL_PARKING',
      wrong_side_detected: issueType === 'WRONG_SIDE',
      vehicle_summary: { count: 1, by_class: { car: 1 }, primary_class: 'car' },
    })
    setProgress(100)
    setStage('done')
  }

  if (stage === 'done') return <ReportComplete report={report} analysis={analysis} file={file} onReset={() => {
    setStage('form'); setFile(null); setFilePreview(null); setDescription(''); setConfirmed(false);
    setProgress(0); setAiSteps(s => s.map(x => ({ ...x, done: false })))
  }} />

  return (
    <div className="container-page py-8 sm:py-12 max-w-4xl">
      <DemoRibbon />
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <Link to="/my-reports" className="link text-xs font-semibold">← My reports</Link>
            <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-ink-900">
              Report a Road Issue
            </h1>
            <p className="mt-1 text-sm text-ink-600">
              Upload a clear photo or short video. Our AI will pre-analyze your evidence before it reaches an authority.
            </p>
          </div>
          <StatusBadge status="SUBMITTED" size="sm" />
        </div>

        {stage !== 'form' && (
          <div className="mb-5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
              <div className="h-full bg-navy-700 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 text-xs text-ink-500">
              {stage === 'uploading' && 'Submitting report and uploading evidence…'}
              {stage === 'analyzing' && 'AI is analyzing evidence — please wait a moment.'}
            </div>
          </div>
        )}

        {stage === 'analyzing' && (
          <Card className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="section-h">Analyzing evidence</h3>
              <span className="chip bg-violet-50 text-violet-700 ring-1 ring-violet-200">
                DEMO AI · Mock inference
              </span>
            </div>
            <ul className="divide-y divide-ink-100 rounded-xl ring-1 ring-black/5">
              {aiSteps.map((s, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <span className={cn(
                    'h-5 w-5 rounded-full grid place-items-center text-[11px] font-bold',
                    s.done ? 'bg-accent-greenSoft text-accent-green ring-1 ring-accent-green/20' : 'bg-ink-100 text-ink-400'
                  )}>
                    {s.done ? '✓' : (i + 1)}
                  </span>
                  <span className={cn('text-sm', s.done ? 'text-ink-800' : 'text-ink-500')}>{s.label}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <form onSubmit={onSubmit} className="space-y-6">
          <Card>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="label !mb-0">Upload a clear photo or video</div>
                <div className="text-xs text-ink-500 mt-0.5">
                  Supported: JPG, JPEG, PNG, MP4, MOV · Max 50 MB
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-accent-amberSoft/70 ring-1 ring-accent-amber/30 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="shrink-0 h-9 w-9 rounded-lg bg-accent-amber/20 ring-1 ring-accent-amber/30 grid place-items-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-amber">
                    <path d="M12 3 2 20h20z" strokeLinejoin="round"/>
                    <path d="M12 10v5M12 18h.01" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-amber-900">
                    Vehicle Video / Photo Guidelines
                  </div>
                  <div className="mt-1.5 text-xs text-amber-900/90 leading-relaxed">
                    For accurate AI analysis and authority review, please ensure your evidence:
                  </div>
                  <ul className="mt-2 space-y-1.5 text-xs text-amber-900/90">
                    <li className="flex items-start gap-2">
                      <span className="text-accent-amber font-bold mt-0.5">✓</span>
                      <span><strong>Clearly shows the entire vehicle</strong> — capture the full body, not just a partial view</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-accent-amber font-bold mt-0.5">✓</span>
                      <span><strong>Number plate is readable</strong> — plate should be in focus, front or rear view</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-accent-amber font-bold mt-0.5">✓</span>
                      <span><strong>Shows road context</strong> — include lane markings, signals, or the violation in action</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-accent-amber font-bold mt-0.5">✓</span>
                      <span><strong>Video: 10–60 seconds</strong> — record the violation from start to end, avoid shaky footage</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-accent-amber font-bold mt-0.5">✓</span>
                      <span><strong>Good lighting</strong> — avoid glare, dark areas, or heavily blurred motion</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <label
              className={cn(
                'mt-4 cursor-pointer block rounded-xl border-2 border-dashed transition',
                file
                  ? 'border-navy-200 bg-navy-50/40'
                  : 'border-ink-200 bg-ink-50 hover:border-navy-300 hover:bg-white'
              )}
            >
              <input ref={inputRef} type="file" accept="image/*,video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0] || null)} />
              <div className="px-6 py-10 sm:py-14 text-center" onClick={() => inputRef.current?.click()}>
                {file ? (
                  <div className="space-y-3">
                    {filePreview && fileType === 'image' && (
                      <img src={filePreview} alt="Preview"
                        className="mx-auto max-h-72 rounded-lg shadow-card ring-1 ring-black/5" />
                    )}
                    {fileType === 'video' && !filePreview && (
                      <div className="mx-auto max-w-sm rounded-xl bg-[repeating-linear-gradient(135deg,#0f172a_0_24px,#1e293b_24px_48px)] text-white aspect-video grid place-items-center">
                        <div className="text-center">
                          <div className="text-4xl">🎬</div>
                          <div className="mt-2 text-sm font-semibold">{file?.name}</div>
                          <div className="text-xs opacity-80">{Math.round((file?.size || 0) / 1024)} KB</div>
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-semibold text-ink-900">{file?.name}</div>
                      <div className="text-xs text-ink-500">
                        {fileType === 'image' ? 'Image' : 'Video'} · {Math.round((file?.size || 0) / 1024)} KB · tap to change
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-md">
                    <div className="mx-auto h-16 w-16 rounded-2xl bg-white shadow-card ring-1 ring-ink-100 grid place-items-center text-navy-700">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M4 17V7a2 2 0 0 1 2-2h2l2-2h8l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </div>
                    <div className="mt-4 text-base font-bold text-ink-900">
                      Tap to upload or drop a file here
                    </div>
                    <div className="mt-1 text-sm text-ink-500">
                      Capture the vehicle, number plate and road context if possible.
                    </div>
                  </div>
                )}
              </div>
            </label>
            {fileError && (
              <div className="mt-3 rounded-xl bg-accent-redSoft text-accent-red ring-1 ring-accent-red/20 px-4 py-3 text-sm">
                {fileError}
              </div>
            )}
          </Card>

          <Card>
            <div className="label">Issue Type</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {ISSUE_OPTIONS.map((opt) => {
                const active = issueType === opt.id
                return (
                  <button key={opt.id} type="button"
                    onClick={() => setIssueType(opt.id)}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-4 text-left transition',
                      active
                        ? 'border-navy-400 bg-navy-50/70 ring-2 ring-navy-100'
                        : 'border-ink-200 bg-white hover:bg-ink-50'
                    )}>
                    <span className={cn(
                      'h-10 w-10 shrink-0 rounded-lg grid place-items-center',
                      active ? 'bg-navy-800 text-white' : 'bg-ink-100 text-ink-700'
                    )}>{opt.icon}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-ink-900">{opt.label}</div>
                      <div className="text-xs text-ink-500 mt-0.5">{opt.desc}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="label !mb-0">Location</div>
              <div className="inline-flex items-center rounded-lg bg-ink-100 p-1 text-xs font-semibold">
                <button type="button" onClick={() => setUseGps(true)}
                  className={cn('rounded-md px-3 py-1.5 transition', useGps && 'bg-white text-ink-900 shadow-card')}>
                  Use Current Location
                </button>
                <button type="button" onClick={() => setUseGps(false)}
                  className={cn('rounded-md px-3 py-1.5 transition', !useGps && 'bg-white text-ink-900 shadow-card')}>
                  Select Manually
                </button>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {useGps ? (
                <div className="rounded-xl bg-accent-blueSoft/60 ring-1 ring-navy-100 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-navy-800">
                    <span className="h-2 w-2 rounded-full bg-navy-700 pulse-alert" />
                    {coords ? 'Location captured' : 'Acquiring location…'}
                  </div>
                  {coords && (
                    <div className="mt-1 text-xs font-mono text-navy-700">
                      {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)} · ±12m
                    </div>
                  )}
                  {gpsError && <div className="text-xs text-accent-amber mt-2">{gpsError}</div>}
                </div>
              ) : (
                <input
                  className="input"
                  placeholder="Enter landmark, street or junction (e.g. Sector 21 Market Gate)"
                  value={manualLoc}
                  onChange={(e) => setManualLoc(e.target.value)}
                />
              )}
            </div>
          </Card>

          <Card>
            <div className="label">Description <span className="text-ink-400 font-normal">(optional)</span></div>
            <textarea
              className="input min-h-[110px] resize-y"
              placeholder="Add any additional details that help traffic authorities understand the situation (e.g. vehicle color, direction, time observed)."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Card>

          <Card className="bg-accent-amberSoft/60 ring-1 ring-accent-amber/20">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input type="checkbox" className="mt-1 h-4 w-4 rounded accent-navy-800"
                checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span className="text-sm text-amber-900">
                I confirm that this submission is genuine to the best of my knowledge.
                I understand RoadWatch is an AI-assisted prototype and that final verification remains with authorized traffic authorities.
              </span>
            </label>
          </Card>

          <div className="flex flex-wrap gap-3 justify-end items-center">
            <Link to="/" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary !px-6 !py-3 text-base" disabled={!submitReady || stage !== 'form'}>
              Submit Report
            </button>
          </div>

          <Disclaimer tone="ai">
            DEMO AI ANALYSIS — prototype uses mock inference. In production, real YOLO + OCR pipelines replace this
            with actual vehicle detection and number-plate recognition (Indian plates).
          </Disclaimer>
        </form>
      </div>
    </div>
  )
}

function ReportComplete({ report, analysis, file, onReset }: any) {
  const nav = useNavigate()
  const quality = analysis?.evidence_quality_score || 82
  const qualityLabel = quality >= 90 ? 'Excellent' : quality >= 75 ? 'Good' : quality >= 50 ? 'Poor' : 'Insufficient'
  return (
    <div className="container-page py-8 sm:py-12 max-w-4xl">
      <DemoRibbon text="REPORT SUBMITTED · DEMO DATA" />
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3 space-y-6">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 shrink-0 rounded-2xl bg-accent-greenSoft text-accent-green ring-1 ring-accent-green/20 grid place-items-center">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 5 5L20 7" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Thank you — report submitted.</h1>
              <p className="mt-1 text-sm text-ink-600">
                Our AI has pre-analyzed your evidence. Traffic authorities will review it shortly.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <InfoPill k="Report #" v={`#${report?.id || '—'}`} />
            <InfoPill k="Case #" v={report?.incident_id ? `RW-2026-${String(report.incident_id).padStart(5, '0')}` : 'Pending'} />
            <InfoPill k="Status" v={<StatusBadge status={analysis ? 'UNDER_REVIEW' : 'SUBMITTED'} />} />
          </div>
          <div>
            <h3 className="section-h">AI Analysis</h3>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-violet-600">
              DEMO AI · MOCK INFERENCE
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow k="Issue" v={<TypeBadge type={analysis?.parking_detected ? 'ILLEGAL_PARKING' : (analysis?.wrong_side_detected ? 'WRONG_SIDE' : 'OTHER')} />} />
            <InfoRow k="Confidence" v={<span className="font-bold text-ink-900 tabular-nums">{Number(analysis?.confidence || 88).toFixed(0)}%</span>} />
            <InfoRow k="Vehicle" v={<span className="font-semibold capitalize text-ink-900">{analysis?.vehicle_summary?.primary_class || 'Car'}</span>} />
            <InfoRow k="Number Plate" v={
              <span className="font-mono font-bold text-ink-900">
                {analysis?.number_plate || <span className="text-ink-400 font-mono font-normal">not clearly readable</span>}
              </span>
            } />
            <InfoRow k="Location" v={<span className="text-ink-800">Sector 21</span>} />
            <InfoRow k="Timestamp" v={<span className="tabular-nums text-ink-800">{new Date().toLocaleString([], { hour: 'numeric', minute: '2-digit' })}</span>} />
          </div>
        </Card>

        <Card className="lg:col-span-2 space-y-6">
          <div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">Evidence Quality</div>
                <div className="mt-0.5 text-5xl font-extrabold tabular-nums text-ink-900">
                  {quality}<span className="text-xl font-semibold text-ink-400">/100</span>
                </div>
                <div className="mt-0.5 text-sm font-bold" style={{
                  color: quality >= 90 ? '#067647' : quality >= 75 ? '#B9770E' : '#EA580C'
                }}>{qualityLabel}</div>
              </div>
              <div className="h-28 w-28 rounded-lg ring-1 ring-black/5 bg-[repeating-linear-gradient(135deg,#0f172a_0_20px,#1e293b_20px_40px)] text-white grid place-items-center text-[10px]">
                EVIDENCE
              </div>
            </div>
            <div className="mt-4 space-y-1.5">
              {Object.entries(analysis?.evidence_quality_breakdown || {}).map(([k, v]) => {
                const ok = (Number(v) || 0) >= 80
                return (
                  <div key={k} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-xs">
                    <span className="text-ink-600 capitalize">{(k as string).replace(/_/g, ' ')}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-bold tabular-nums text-ink-800">{Number(v).toFixed(0)}</span>
                      {ok ? <span className="text-accent-green">✓</span> : <span className="text-accent-amber">△</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="rounded-xl bg-navy-50 p-4 ring-1 ring-navy-100">
            <div className="text-[11px] font-bold uppercase tracking-wider text-navy-700">What happens next</div>
            <ol className="mt-2 space-y-2 text-sm text-ink-800">
              <li>1. An authority will review the incident and AI analysis.</li>
              <li>2. They may verify, reject or request more information.</li>
              <li>3. If verified, the incident may feed into corridor hotspot analytics and interventions.</li>
            </ol>
          </div>
          <div className="grid gap-2">
            <button onClick={() => nav('/my-reports')} className="btn-primary w-full">
              Track my reports
            </button>
            <button onClick={onReset} className="btn-secondary w-full">
              Submit another report
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function InfoPill({ k, v }: any) {
  return (
    <div className="rounded-xl bg-ink-50 px-4 py-3 ring-1 ring-ink-100">
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-500">{k}</div>
      <div className="mt-1 text-sm font-bold text-ink-900">{v}</div>
    </div>
  )
}
function InfoRow({ k, v }: any) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-ink-50 px-4 py-3 ring-1 ring-ink-100">
      <span className="text-xs font-bold uppercase tracking-wider text-ink-500 pt-1">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  )
}

function IconParked() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9" strokeLinecap="round"/></svg> }
function IconWrongSide() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16"/><path d="m14 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 6v12" strokeLinecap="round"/></svg> }
function IconCone() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 3-7 17h14z" strokeLinejoin="round"/><path d="M7 15h10" strokeLinecap="round"/><path d="M9 11h6" strokeLinecap="round"/></svg> }
function IconWarn() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3 2 20h20z" strokeLinejoin="round"/><path d="M12 10v5M12 18h.01" strokeLinecap="round"/></svg> }
function IconSignal() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="2" width="8" height="20" rx="3"/><circle cx="12" cy="7" r="1.5" fill="#EF4444" stroke="none"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="17" r="1.5"/></svg> }
function IconFlag() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5" strokeLinejoin="round"/></svg> }
