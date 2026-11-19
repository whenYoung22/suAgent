import { AgentToolError } from "./types.js";
import type { AgentToolDefinition, AgentToolExecution } from "./types.js";
import { getStringArgument, isRecord, validateArguments } from "./validation.js";

export const weatherToolDefinition: AgentToolDefinition = {
    type: "function",
    function: {
        name: "get_weather",
        description: "查询指定城市当前天气。",
        parameters: {
            type: "object",
            properties: {
                city: {
                    type: "string",
                    description: "城市英文名或拼音，例如 Changsha、Kunming、Tokyo；Open-Meteo 地理编码按英文名称查询。"
                },
                country: {
                    type: "string",
                    description: "可选的国家名称或 ISO 3166-1 alpha-2 两位国家代码（例如 Japan 或 JP；不要使用 JPN 这样的三位代码），用于区分同名城市。"
                },
                region: {
                    type: "string",
                    description: "可选的英文省份、州或行政区名称，例如 Hunan，用于区分同名地点。"
                }
            },
            required: ["city"],
            additionalProperties: false
        }
    }
};

interface GeocodedLocation {
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    countryCode?: string;
    admin1?: string;
    admin2?: string;
    featureCode?: string;
}

async function fetchJson(
    url: URL,
    signal: AbortSignal,
    serviceName: string
): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(url, { signal });
    } catch (error) {
        if (signal.aborted) {
            throw error;
        }
        throw new AgentToolError(`The ${serviceName} service could not be reached.`);
    }

    if (!response.ok) {
        throw new AgentToolError(`${serviceName} returned HTTP ${response.status}.`);
    }

    try {
        return await response.json() as unknown;
    } catch {
        throw new AgentToolError(`${serviceName} returned an invalid response.`);
    }
}

function toGeocodedLocation(value: unknown): GeocodedLocation | undefined {
    if (!isRecord(value) ||
        typeof value.name !== "string" ||
        typeof value.latitude !== "number" ||
        typeof value.longitude !== "number") {
        return undefined;
    }

    return {
        name: value.name,
        latitude: value.latitude,
        longitude: value.longitude,
        ...(typeof value.country === "string" ? { country: value.country } : {}),
        ...(typeof value.country_code === "string"
            ? { countryCode: value.country_code }
            : {}),
        ...(typeof value.admin1 === "string" ? { admin1: value.admin1 } : {}),
        ...(typeof value.admin2 === "string" ? { admin2: value.admin2 } : {}),
        ...(typeof value.feature_code === "string"
            ? { featureCode: value.feature_code }
            : {})
    };
}

function normalizeLocationValue(value: string): string {
    return value
        .trim()
        .toLocaleLowerCase()
        .replace(/[\s,，、·.()（）_-]/g, "")
        .replace(
            /(市辖区|特别行政区|自治区|自治州|自治县|省|市|区|县|旗|盟|地区|都|province|state|city|county|district|prefecture)$/i,
            ""
        );
}

function stripLocationSuffix(value: string): string {
    return value
        .trim()
        .replace(
            /(?:市辖区|特别行政区|自治区|自治州|自治县|省|市|区|县|旗|盟|地区|都)$/u,
            ""
        )
        .replace(/\s+(?:province|state|city|county|district|prefecture)$/i, "")
        .trim();
}

const isoAlpha3ToAlpha2: Record<string, string> = {
    JPN: "JP",
    USA: "US",
    GBR: "GB",
    CHN: "CN",
    KOR: "KR",
    FRA: "FR",
    DEU: "DE",
    ITA: "IT",
    ESP: "ES",
    IND: "IN",
    CAN: "CA",
    AUS: "AU",
    SGP: "SG",
    NZL: "NZ",
    RUS: "RU",
    BRA: "BR",
    MEX: "MX",
    THA: "TH",
    MYS: "MY",
    IDN: "ID",
    VNM: "VN",
    PHL: "PH",
    TUR: "TR",
    CHE: "CH",
    NLD: "NL",
    SWE: "SE",
    NOR: "NO",
    DNK: "DK",
    FIN: "FI",
    PRT: "PT",
    POL: "PL",
    ARE: "AE",
    SAU: "SA",
    ZAF: "ZA",
    EGY: "EG",
    ARG: "AR",
    CHL: "CL",
    COL: "CO",
    PER: "PE",
    ISR: "IL",
    IRN: "IR",
    PAK: "PK",
    BGD: "BD",
    NPL: "NP",
    LKA: "LK"
};

function normalizeCountryFilter(country: string | undefined): string | undefined {
    if (!country) {
        return undefined;
    }
    const normalized = normalizeLocationValue(country);
    return isoAlpha3ToAlpha2[normalized.toUpperCase()] ?? country;
}

function matchesLocationFilter(
    values: Array<string | undefined>,
    requestedValue: string | undefined
): boolean {
    if (!requestedValue) {
        return true;
    }
    const requested = normalizeLocationValue(requestedValue);
    return values.some((value) =>
        value !== undefined && normalizeLocationValue(value) === requested
    );
}

function getFeaturePriority(featureCode: string | undefined): number {
    switch (featureCode) {
        case "PPLC":
            return 6;
        case "PPLA":
            return 5;
        case "PPLA2":
            return 4;
        case "PPLA3":
            return 3;
        case "PPLA4":
            return 2;
        case "PPL":
            return 1;
        default:
            return 0;
    }
}

function selectGeocodedLocation(
    locations: GeocodedLocation[],
    city: string,
    country?: string,
    region?: string
): GeocodedLocation {
    const needsEnglishName = /[\u3400-\u9fff]/u.test(city) ||
        (region !== undefined && /[\u3400-\u9fff]/u.test(region));
    const hint = needsEnglishName
        ? " Retry with English or pinyin names for the city and region (for example Changsha and Hunan)."
        : "";
    const matches = locations.filter((location) =>
        matchesLocationFilter(
            [location.country, location.countryCode],
            normalizeCountryFilter(country)
        ) &&
        matchesLocationFilter([location.admin1, location.admin2], region)
    );

    if (matches.length === 0) {
        if (locations.length === 0) {
            throw new AgentToolError(
                `Open-Meteo could not find a location named "${city}".${hint}`
            );
        }
        if (country && /^[a-z]{3}$/i.test(country) &&
            !isoAlpha3ToAlpha2[normalizeLocationValue(country).toUpperCase()]) {
            throw new AgentToolError(
                `Country code "${country}" is not recognized. Use an ISO 3166-1 alpha-2 code (for example JP) or omit country.`
            );
        }
        throw new AgentToolError(
            `No Open-Meteo result for "${city}" matched the requested country or region.${hint}`
        );
    }

    const uniqueLocations = new Map<string, GeocodedLocation>();
    for (const location of matches) {
        const key = [
            location.countryCode ?? location.country ?? "",
            location.latitude,
            location.longitude
        ].join(":");
        if (!uniqueLocations.has(key)) {
            uniqueLocations.set(key, location);
        }
    }

    const results = [...uniqueLocations.values()];
    const exactNameMatches = results.filter((location) =>
        normalizeLocationValue(location.name) === normalizeLocationValue(city)
    );
    const namedResults = exactNameMatches.length > 0
        ? exactNameMatches
        : results;
    const countries = new Set(namedResults
        .map((location) => location.countryCode ?? location.country)
        .filter((value): value is string => value !== undefined));
    if (!country && countries.size > 1) {
        throw new AgentToolError(
            `"${city}" matches locations in multiple countries. Specify a country or region.${hint}`
        );
    }

    const bestPriority = Math.max(...namedResults.map((location) =>
        getFeaturePriority(location.featureCode)
    ));
    const preferredResults = namedResults.filter((location) =>
        getFeaturePriority(location.featureCode) === bestPriority
    );
    if (preferredResults.length > 1) {
        throw new AgentToolError(
            `"${city}" matches multiple locations. Specify a country or region.${hint}`
        );
    }
    return preferredResults[0];
}

export async function executeWeatherTool(
    args: unknown,
    signal: AbortSignal
): Promise<AgentToolExecution> {
    const record = validateArguments(args, ["city", "country", "region"]);
    const city = getStringArgument(record, "city", true)!;
    const country = getStringArgument(record, "country", false);
    const region = getStringArgument(record, "region", false);
    const geocodingName = stripLocationSuffix(city) || city;
    const apiToken = process.env.CAIYUN_API_TOKEN?.trim();
    if (!apiToken) {
        throw new AgentToolError("CAIYUN_API_TOKEN is not configured on the server.");
    }

    const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodingUrl.searchParams.set("name", geocodingName);
    geocodingUrl.searchParams.set("count", "100");
    geocodingUrl.searchParams.set("language", "en");
    geocodingUrl.searchParams.set("format", "json");
    const geocodingPayload = await fetchJson(
        geocodingUrl,
        signal,
        "Open-Meteo geocoding API"
    );
    if (!isRecord(geocodingPayload) ||
        (geocodingPayload.results !== undefined &&
            geocodingPayload.results !== null &&
            !Array.isArray(geocodingPayload.results))) {
        throw new AgentToolError("Open-Meteo returned an invalid geocoding response.");
    }
    const geocodingResults = Array.isArray(geocodingPayload.results)
        ? geocodingPayload.results
        : [];
    const locations: GeocodedLocation[] = [];
    for (const result of geocodingResults) {
        const location = toGeocodedLocation(result);
        if (!location) {
            throw new AgentToolError("Open-Meteo returned an invalid geocoding result.");
        }
        locations.push(location);
    }
    const location = selectGeocodedLocation(locations, city, country, region);

    const weatherUrl = new URL(
        `https://api.caiyunapp.com/v2.5/${encodeURIComponent(apiToken)}/${location.longitude},${location.latitude}/weather.json`
    );
    weatherUrl.searchParams.set("lang", "zh_CN");
    weatherUrl.searchParams.set("unit", "metric");
    weatherUrl.searchParams.set("alert", "true");
    const weatherPayload = await fetchJson(weatherUrl, signal, "Caiyun weather API");

    if (!isRecord(weatherPayload) ||
        weatherPayload.status !== "ok" ||
        !isRecord(weatherPayload.result) ||
        !isRecord(weatherPayload.result.realtime) ||
        weatherPayload.result.realtime.status !== "ok") {
        throw new AgentToolError("Caiyun returned an unsuccessful or incomplete weather response.");
    }

    const result = weatherPayload.result as Record<string, unknown>;
    const realtime = result.realtime as Record<string, unknown>;
    const minutely = isRecord(result.minutely) ? result.minutely : null;
    const hourly = isRecord(result.hourly) ? result.hourly : null;
    const alert = isRecord(result.alert) ? result.alert : null;
    const alerts = alert && Array.isArray(alert.content)
        ? alert.content.filter(isRecord).map((item) => ({
            ...(typeof item.title === "string" ? { title: item.title } : {}),
            ...(typeof item.description === "string"
                ? { description: item.description }
                : {}),
            ...(typeof item.status === "string" ? { status: item.status } : {})
        }))
        : [];

    return {
        success: true,
        result: {
            location: {
                name: location.name,
                ...(location.admin1 ? { region: location.admin1 } : {}),
                ...(location.country ? { country: location.country } : {}),
                ...(location.countryCode ? { countryCode: location.countryCode } : {})
            },
            provider: "Caiyun",
            timezone: typeof weatherPayload.timezone === "string"
                ? weatherPayload.timezone
                : undefined,
            realtime: {
                ...(typeof realtime.temperature === "number"
                    ? { temperature: realtime.temperature }
                    : {}),
                ...(typeof realtime.apparent_temperature === "number"
                    ? { apparentTemperature: realtime.apparent_temperature }
                    : {}),
                ...(typeof realtime.humidity === "number"
                    ? { humidity: realtime.humidity }
                    : {}),
                ...(typeof realtime.skycon === "string"
                    ? { condition: realtime.skycon }
                    : {}),
                ...(isRecord(realtime.wind) ? { wind: realtime.wind } : {}),
                ...(isRecord(realtime.precipitation)
                    ? { precipitation: realtime.precipitation }
                    : {}),
                ...(isRecord(realtime.air_quality)
                    ? { airQuality: realtime.air_quality }
                    : {}),
                ...(isRecord(realtime.life_index)
                    ? { lifeIndex: realtime.life_index }
                    : {})
            },
            ...(typeof minutely?.description === "string"
                ? { minutelyForecast: minutely.description }
                : {}),
            ...(typeof hourly?.description === "string"
                ? { hourlyForecast: hourly.description }
                : {}),
            ...(alerts.length > 0 ? { alerts } : {})
        }
    };
}
