/**
 * 학급 RPG 모의투자 시스템을 위한 한국투자증권 KIS Developers API 프록시 스크립트
 * 
 * [안내]
 * 이 스크립트는 Google Apps Script(GAS)에 배포하여 사용합니다.
 * 학생들의 프론트엔드(Client)에서 한국투자증권 API를 직접 호출할 경우 발생하는 
 * CORS 보안 오류를 우회하고, 선생님의 KIS AppKey 및 AppSecret을 안전하게 보호합니다.
 * 
 * [보안설정 및 변수등록]
 * GAS 스크립트 편집기 왼쪽의 톱니바퀴 아이콘(프로젝트 설정) -> [스크립트 속성]에 아래 3개 속성을 추가해 주세요.
 * 1. KIS_APP_KEY    : 한국투자증권에서 발급받은 AppKey
 * 2. KIS_APP_SECRET : 한국투자증권에서 발급받은 AppSecret
 * 3. KIS_IS_MOCK    : 모의투자계좌인 경우 true, 실전계좌인 경우 false (기본값 true)
 */

function doGet(e) {
  // CORS 우회를 위해 헤더를 설정하여 JSON 반환
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var action = e.parameter.action;
    if (action !== "prices") {
      return output.setContent(JSON.stringify({ ok: false, error: "유효하지 않은 요청(action)입니다." }));
    }

    var codesStr = e.parameter.codes;
    if (!codesStr) {
      return output.setContent(JSON.stringify({ ok: false, error: "종목코드(codes)가 지정되지 않았습니다." }));
    }

    var codes = codesStr.split(",");

    // 한국투자증권 API 호출을 위한 크레덴셜 정보 로드 (Script Properties)
    var props = PropertiesService.getScriptProperties();
    var appKey = props.getProperty("KIS_APP_KEY");
    var appSecret = props.getProperty("KIS_APP_SECRET");
    var isMock = props.getProperty("KIS_IS_MOCK") !== "false"; // 기본값 true

    if (!appKey || !appSecret) {
      return output.setContent(JSON.stringify({
        ok: false,
        error: "GAS 스크립트 설정(Script Properties)에 KIS_APP_KEY 또는 KIS_APP_SECRET이 등록되지 않았습니다. GAS 설정을 확인해 주세요."
      }));
    }

    // API 베이스 URL 설정
    var baseUrl = isMock
      ? "https://openapivts.koreainvestment.com:29443"
      : "https://openapi.koreainvestment.com:9443";

    // 1단계: 유효한 Access Token 가져오기 (캐시 활용)
    var token = getAccessToken(baseUrl, appKey, appSecret);

    // 2단계: 종목별 실시간 시세 조회 (모의투자/실전투자 호출 제한 대응)
    var data = {};

    if (isMock) {
      // [모의투자 환경] 초당 2건 제한이 매우 엄격하므로, 순차적으로 호출하며 0.51초씩 대기(Utilities.sleep)합니다.
      for (var i = 0; i < codes.length; i++) {
        var code = codes[i].trim();
        if (!code) continue;

        var url = baseUrl + "/uapi/domestic-stock/v1/quotations/inquire-price"
          + "?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=" + code;

        var options = {
          "method": "get",
          "headers": {
            "content-type": "application/json; charset=utf-8",
            "authorization": "Bearer " + token,
            "appkey": appKey,
            "appsecret": appSecret,
            "tr_id": "FHKST01010100", // 주식 현재가 시세 TR ID
            "custtype": "P"            // 개인
          },
          "muteHttpExceptions": true
        };

        try {
          var response = null;
          var retries = 2; // 총 3회 시도 (1차 시도 + 2회 재시도)
          var lastError = "";
          
          while (retries >= 0) {
            try {
              response = UrlFetchApp.fetch(url, options);
              
              // HTTP 상태 코드가 200(성공)인 경우에만 루프 탈출
              if (response && response.getResponseCode() === 200) {
                break;
              }
              
              // KIS 서버가 초당 제한 등으로 HTTP 500 / 429 에러를 주는 경우 재시도 처리
              var responseCode = response ? response.getResponseCode() : "unknown";
              lastError = "HTTP " + responseCode + " (과부하 또는 한도초과)";
              
            } catch (fetchErr) {
              lastError = fetchErr.toString();
            }
            
            // 실패한 경우 좀 더 긴 시간(1.5초) 대기 후 재시도
            if (retries > 0) {
              Utilities.sleep(1500); 
            }
            retries--;
          }
          
          if (!response || response.getResponseCode() !== 200) {
            data[code] = {
              code: code,
              price: 0,
              error: "시세 조회 실패: " + lastError
            };
            
            // 실패하더라도 다음 호출 전 대기 (초당 2건 제한 절대 사수)
            if (i < codes.length - 1) {
              Utilities.sleep(1200);
            }
            continue;
          }
          
          var responseText = response.getContentText();
          var resJson = JSON.parse(responseText);
          
          if (resJson && resJson.output) {
            var priceVal = parseInt(resJson.output.stck_prpr, 10);
            if (!isNaN(priceVal)) {
              data[code] = {
                code: code,
                price: priceVal,
                name: resJson.output.hts_kor_shr_nme || "" // HTS 한글 종목명
              };
              
              // 성공 시 다음 호출 전 대기 (초당 2건 제한 준수를 위해 1.2초 안전 지연)
              if (i < codes.length - 1) {
                Utilities.sleep(1200); 
              }
              continue;
            }
          }
          
          data[code] = {
            code: code,
            price: 0,
            error: "응답 데이터 분석 실패"
          };
          
        } catch (outerErr) {
          data[code] = {
            code: code,
            price: 0,
            error: "GAS 내부 처리 오류: " + outerErr.toString()
          };
        }
        
        // 다음 호출 전 대기 (안전 지연)
        if (i < codes.length - 1) {
          Utilities.sleep(1200);
        }
      }
    } else {
      // [실전투자 환경] 초당 20건까지 허용되므로, 구글 앱스 스크립트의 최대 장점인 병렬 호출(fetchAll)로 속도 극대화
      var requests = codes.map(function (code) {
        code = code.trim();
        var url = baseUrl + "/uapi/domestic-stock/v1/quotations/inquire-price"
          + "?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=" + code;

        return {
          url: url,
          method: "get",
          headers: {
            "content-type": "application/json; charset=utf-8",
            "authorization": "Bearer " + token,
            "appkey": appKey,
            "appsecret": appSecret,
            "tr_id": "FHKST01010100", // 주식 현재가 시세 TR ID
            "custtype": "P"            // 개인
          },
          muteHttpExceptions: true
        };
      });

      var responses = UrlFetchApp.fetchAll(requests);

      for (var i = 0; i < codes.length; i++) {
        var code = codes[i].trim();
        var response = responses[i];
        var responseCode = response.getResponseCode();
        var responseText = response.getContentText();

        if (responseCode === 200) {
          var resJson = JSON.parse(responseText);
          if (resJson && resJson.output) {
            var priceVal = parseInt(resJson.output.stck_prpr, 10);
            if (!isNaN(priceVal)) {
              data[code] = {
                code: code,
                price: priceVal,
                name: resJson.output.hts_kor_shr_nme || "" // HTS 한글 종목명
              };
              continue;
            }
          }
        }

        data[code] = {
          code: code,
          price: 0,
          error: "시세 조회 실패 (HTTP " + responseCode + ")"
        };
      }
    }

    return output.setContent(JSON.stringify({ ok: true, data: data }));

  } catch (err) {
    return output.setContent(JSON.stringify({ ok: false, error: "GAS 내부 오류: " + err.toString() }));
  }
}

/**
 * 한국투자증권 Access Token 발급 및 캐싱 기능
 * 토큰 유효기간(24시간) 동안 무분별한 토큰 발급 API 호출을 방지하여 KIS 서버 차단을 예방하고 성능을 최적화합니다.
 */
function getAccessToken(baseUrl, appKey, appSecret) {
  var props = PropertiesService.getScriptProperties();
  var cachedToken = props.getProperty("KIS_ACCESS_TOKEN");
  var expireStr = props.getProperty("KIS_TOKEN_EXPIRED"); // ISO 8601 형식

  var now = new Date();

  // 이미 유효한 토큰이 스크립트 속성에 캐싱되어 있는 경우 그대로 사용 (만료 1시간 전 안전마진 확보)
  if (cachedToken && expireStr) {
    var expireTime = new Date(expireStr);
    var safetyMargin = 60 * 60 * 1000; // 1시간 (밀리초)
    if (expireTime.getTime() - now.getTime() > safetyMargin) {
      return cachedToken;
    }
  }

  // 토큰이 없거나 만료된 경우 신규 토큰 발급 요청
  var url = baseUrl + "/oauth2/tokenP";
  var payload = {
    "grant_type": "client_credentials",
    "appkey": appKey,
    "appsecret": appSecret
  };

  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  var response = UrlFetchApp.fetch(url, options);
  var responseCode = response.getResponseCode();
  var responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error("KIS 토큰 발급 실패 (HTTP " + responseCode + "): " + responseText);
  }

  var resJson = JSON.parse(responseText);
  var token = resJson.access_token;
  var expiredDateStr = resJson.access_token_token_expired; // 예: "2026-05-22 12:00:00"

  if (!token) {
    throw new Error("KIS 응답에 access_token이 누락되었습니다: " + responseText);
  }

  // KIS에서 반환한 "YYYY-MM-DD HH:mm:ss" 포맷을 Date 객체로 파싱하여 저장
  var parsedExpireDate;
  if (expiredDateStr) {
    // 공백 및 기호 보정
    var t = expiredDateStr.replace(" ", "T");
    parsedExpireDate = new Date(t);
  }

  // 만약 파싱 실패 시 현재 시간 기준 +23시간 후 만료로 수동 설정
  if (!parsedExpireDate || isNaN(parsedExpireDate.getTime())) {
    parsedExpireDate = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  }

  // 새로 발급받은 토큰과 만료 시간을 속성에 캐시 저장
  props.setProperty("KIS_ACCESS_TOKEN", token);
  props.setProperty("KIS_TOKEN_EXPIRED", parsedExpireDate.toISOString());

  return token;
}
