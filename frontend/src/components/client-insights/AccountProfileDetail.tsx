import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { fetchAccountProfileDetail } from "../../services/api";
import { useInsightAsOf } from "./InsightAsOf";
import { FUND_CODES, formatCount, formatDate, formatGroupLabel, formatPct, formatUGX } from "./insightFormat";

type FundPct = Record<(typeof FUND_CODES)[number], number | null>;

interface AccountDetail {
  accountNumber: string;
  accountType: string;
  accountCategory: string;
  clientName: string;
  clientCode: string | null;
  balance: number;
  isFunded: boolean;
  gender: string;
  ageYears: number | null;
  dateOfBirth: string | null;
  location: string | null;
  region: string | null;
  country: string | null;
  districtRaw: string | null;
  signupChannel: string;
  signupPlatform: string | null;
  phoneNetwork: string;
  portalEnabled: boolean | null;
  enrollmentStatus: string | null;
  userJoinedAt: string | null;
  contactClosed: boolean;
  sponsorAccountNumber: string | null;
  institutionName: string | null;
  equityValue: number;
  averageRiskScore: number | null;
  lastDepositDate: string | null;
  depositsLast12Months: number;
  missing: string[];
  activity: {
    firstDepositDate: string | null;
    lastWithdrawalDate: string | null;
    depositCount: number;
    depositTotal: number;
    withdrawalCount: number;
    withdrawalTotal: number;
    depositAmountLast12Months: number;
  };
  goals: Array<{
    goalNumber: string;
    goalTitle: string;
    category: string;
    riskScore: number | null;
    value: number;
    isFunded: boolean;
    actualPct: FundPct;
    targetPct: FundPct;
    equityGapPp: number | null;
    ultimaTarget: number | null;
    ultimaValue: number | null;
    ultimaAsOf: string | null;
  }>;
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <dt className="text-xs text-gray-500">{label}</dt>
    <dd className="text-sm text-gray-900 mt-0.5">{children ?? <span className="text-gray-400">–</span>}</dd>
  </div>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-t border-gray-100 pt-4">
    <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>
    {children}
  </section>
);

const formatFundMix = (pct: FundPct) =>
  FUND_CODES.some((f) => pct[f] !== null) ? FUND_CODES.map((f) => `${Math.round(pct[f] ?? 0)}`).join(" / ") : "–";

/**
 * Slide-over with one account's full profile, saving activity and goals (value,
 * fund mix against the Ultima target, Ultima goal target and progress). Fetched
 * when opened and cached, so reopening an account is instant. Esc closes it.
 */
const AccountProfileDetail = ({ accountNumber, onClose }: { accountNumber: string; onClose: () => void }) => {
  const { asOf } = useInsightAsOf();
  const { data, error, isPending } = useQuery<AccountDetail>({
    queryKey: ["account-profile", accountNumber, asOf],
    queryFn: ({ signal }) => fetchAccountProfileDetail(accountNumber, signal, asOf),
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    const closeOnEscape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const genderLabel = (gender: string) =>
    gender === "UNKNOWN" ? "Not declared" : gender === "UNDISCLOSED" ? "Rather not say" : formatGroupLabel(gender);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-2xl h-full bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{data?.clientName ?? accountNumber}</h2>
            <p className="text-sm text-gray-500 font-mono">{accountNumber}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isPending && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        )}
        {error && <p className="p-6 text-red-700">{(error as Error).message}</p>}

        {data && (
          <div className="px-6 py-5 space-y-5">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Balance">{formatUGX(data.balance)}</Field>
              <Field label="Account type">
                {formatGroupLabel(data.accountType)} · {formatGroupLabel(data.accountCategory)}
              </Field>
              <Field label="Equity share">{data.balance > 0 ? formatPct(data.equityValue / data.balance, 0) : null}</Field>
            </div>
            {data.missing.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
                Missing from Ultima: {data.missing.join(", ")}
              </div>
            )}

            <Section title="Profile (from Ultima)">
              <dl className="grid grid-cols-3 gap-4">
                <Field label="Gender">{genderLabel(data.gender)}</Field>
                <Field label="Date of birth">{data.dateOfBirth ? `${formatDate(data.dateOfBirth)} (age ${data.ageYears})` : null}</Field>
                <Field label="Location">{data.location}</Field>
                <Field label="Region">{data.region ? formatGroupLabel(data.region) : null}</Field>
                <Field label="Location as typed">{data.districtRaw}</Field>
                <Field label="Sign-up">
                  {formatGroupLabel(data.signupChannel)}
                  {data.signupPlatform ? ` · ${formatGroupLabel(data.signupPlatform)}` : ""}
                </Field>
                <Field label="Phone network">{formatGroupLabel(data.phoneNetwork)}</Field>
                <Field label="Joined Ultima">{data.userJoinedAt ? formatDate(data.userJoinedAt) : null}</Field>
                <Field label="Portal">
                  {data.portalEnabled === null ? null : data.portalEnabled ? "Enabled" : "Disabled"}
                  {data.contactClosed ? " · user closed" : ""}
                </Field>
                {(data.sponsorAccountNumber || data.institutionName) && (
                  <Field label="Sponsor / institution">
                    {[data.institutionName, data.sponsorAccountNumber].filter(Boolean).join(" · ")}
                  </Field>
                )}
              </dl>
            </Section>

            <Section title="Saving activity">
              <dl className="grid grid-cols-3 gap-4">
                <Field label="First deposit">{data.activity.firstDepositDate ? formatDate(data.activity.firstDepositDate) : null}</Field>
                <Field label="Last deposit">{data.lastDepositDate ? formatDate(data.lastDepositDate) : null}</Field>
                <Field label="Last withdrawal">{data.activity.lastWithdrawalDate ? formatDate(data.activity.lastWithdrawalDate) : null}</Field>
                <Field label="Deposits">
                  {formatCount(data.activity.depositCount)} · {formatUGX(data.activity.depositTotal)}
                </Field>
                <Field label="Withdrawals">
                  {formatCount(data.activity.withdrawalCount)} · {formatUGX(data.activity.withdrawalTotal)}
                </Field>
                <Field label="Deposited in last 12 months">
                  {formatCount(data.depositsLast12Months)} · {formatUGX(data.activity.depositAmountLast12Months)}
                </Field>
              </dl>
            </Section>

            <Section title={`Goals (${data.goals.length})`}>
              {data.goals.length === 0 ? (
                <p className="text-sm text-gray-500">No goals.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-600">
                      <th className="text-left py-2 font-medium">Goal</th>
                      <th className="text-right py-2 font-medium">Risk</th>
                      <th className="text-right py-2 font-medium">Value</th>
                      <th className="text-right py-2 font-medium" title="XUMMF / XUBF / XUDEF / XUREF, %">
                        Mix: actual / target
                      </th>
                      <th className="text-right py-2 font-medium">Ultima target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.goals.map((g) => (
                      <tr key={g.goalNumber} className="border-b border-gray-100 align-top">
                        <td className="py-2 pr-2">
                          <div className="text-gray-900">{g.goalTitle}</div>
                          <div className="text-xs text-gray-500">
                            {formatGroupLabel(g.category)} · <span className="font-mono">{g.goalNumber}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right text-gray-900">{g.riskScore ?? "–"}</td>
                        <td className="py-2 text-right text-gray-900 whitespace-nowrap">{formatUGX(g.value)}</td>
                        <td className="py-2 text-right text-xs text-gray-700 whitespace-nowrap">
                          <div>{formatFundMix(g.actualPct)}</div>
                          <div className="text-gray-500">{formatFundMix(g.targetPct)}</div>
                        </td>
                        <td className="py-2 text-right text-gray-900 whitespace-nowrap">
                          {g.ultimaTarget ? (
                            <>
                              <div>{formatUGX(g.ultimaTarget)}</div>
                              <div className="text-xs text-gray-500">
                                {g.ultimaValue !== null ? `${formatPct(g.ultimaValue / g.ultimaTarget, 0)} reached` : ""}
                              </div>
                            </>
                          ) : (
                            "–"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-xs text-gray-500 mt-2">Mix is XUMMF / XUBF / XUDEF / XUREF in %; the target is Ultima's split for the risk score.</p>
            </Section>
          </div>
        )}
      </aside>
    </div>
  );
};

export default AccountProfileDetail;
