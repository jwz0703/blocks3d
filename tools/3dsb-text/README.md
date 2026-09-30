# 專案 ↔ 文字工具

把 `.3dsb`（或 `.sb3`、`project.json`）轉成文字，讓 AI 和人直接讀、改，改完再轉回專案。只需要 Node（用到 `scratch-vm` 與 `scratch-gui/node_modules/scratch-blocks`，不用建置）。

```sh
node tools/3dsb-text.js dump 專案.3dsb -o 專案.txt       # 專案 → 文字
node tools/3dsb-text.js build 專案.txt -o 新專案.3dsb    # 文字 → 專案（先驗證）
node tools/3dsb-text.js help                             # 所有指令
node --test --test-force-exit tools/3dsb-text/test/run.js  # 測試
```

| 指令 | 用途 |
| --- | --- |
| `dump <專案> [-o 文字] [--ids] [--no-labels] [--sprite 名稱]…` | 輸出文字。`--ids` 寫出每個積木的 id，轉回去 `project.json` 完全一樣；不加的話 id 重新產生，積木相同。 |
| `build <文字> -o <專案> [--assets 來源] [--no-check]` | 轉回專案。素材從文字開頭 `assets` 那行的專案（或 `--assets`）複製；輸出 `.json` 就只寫 `project.json`。有錯誤就不寫。 |
| `check <文字或專案>` | 驗證（見下面）。 |
| `roundtrip <專案>` | 往返測試：有 id 時 `project.json` 完全一樣，沒有 id 時再轉成文字完全一樣。 |
| `stats <專案> [--sprite 名稱]` | 每個角色的 script、積木（含 / 不含 shadow）、自訂積木、變數數量，最常用的積木。 |
| `refs <專案> <名稱>` | 哪裡用到某個變數（路徑：`分數`、`self.hp`、`local.i`）、舊的變數 / 清單或廣播，讀還是寫。SVG 造型的綁定也算（「造型「計數」第 3 行（綁定）」，讀取）。 |
| `opcodes <專案>` | 用到的 opcode 與次數。 |
| `replace-script` / `add-script` / `delete-script` / `insert` | 局部修改，見「局部修改」。 |
| `compile <程式.b3s> [-o 文字]` | 把簡化語法編譯成文字格式。 |

## 給 AI 的注意事項

- **不要自己寫分身 id 的邏輯**（例如用全域計數器編號、存到分身變數、再用清單找分身）。內建就有：
  - `control_create_clone_of CLONE_OPTION=menu("角色") ID=值`（建立 [角色] 的分身 id = ()）：留空會自動編號 1、2、3…
  - `control_start_as_clone`（當分身產生 (id)）：`id` 可以直接拿來用；分身變數 `id`（`self.id`）也是，主體是 0。
  - 依 id 操作分身：`twclonevars_deleteClones`、`twclonevars_cloneExists`、`twclonevars_getOfClone`、`twclonevars_setOfClone`（刪除 / 存在？ / 讀 / 設定 [角色] id 為 () 的分身）。
- **判斷自己是不是分身用 `twclonevars_isClone`（是分身？）**，是不是主體就用 `operator_not` 包起來；不要自己設一個「是分身」的變數。簡化語法是 `isclone()` / `not isclone()`。

## 文字格式

```
blocks3d-text 1
assets "durian-voxel-physics.3dsb"
project meta {"semver":"3.0.0","format":"3dsb","formatVersion":3}
project extensions ["twdata","physics3d"]

stage "Stage"
  prop currentCostume 0
  prop costumes [{"name":"背景1", ...}]
  variable "分數" 0 @id "k0_i03jy"
  broadcast "shake" @id "k6o_jcryx"

sprite "搖樹按鈕"
  prop kind "2d"
  prop x -606
  script 0 600  # script 2
    event_whenflagclicked  # 當綠旗被點擊
    control_forever  # 重複無限次
      SUBSTACK:
        control_if_else CONDITION=(sensing_touchingobject TOUCHINGOBJECTMENU=menu("_mouse_"))  # 如果 ( ) 那麼 否則
          SUBSTACK:
            looks_switchcostumeto COSTUME=menu("滑鼠移入")  # 造型換成 [滑鼠移入]
          SUBSTACK2:
            looks_switchcostumeto COSTUME=menu("一般")  # 造型換成 [一般]
```

- `#` 後面是註解，轉回時不讀。`dump` 在每個積木後面附上編輯器上的中文（從 scratch-blocks 的繁中訊息、scratch-gui `lib/blocks.js` 和 VM 擴充的 `getInfo()` 自動產生，新增積木不用改工具），`# script N` 是 script 的編號（局部修改用）。
- 縮排表示巢狀（用空白）。括號還沒關上時，一行可以接到下一行。
- 最外層：`project 鍵 JSON`（`project.json` 裡除了 targets 的每一項）、`stage "名稱"`、`sprite "名稱"`。
- 角色裡：`prop 鍵 JSON`（角色的其他屬性，依序）、`variable "名稱" 值 @id "id"`（雲端變數加 `@cloud`）、`list "名稱" [值…] @id "id"`、`broadcast "名稱" @id "id"`、`comment {…}`（不在積木上的註解）、`script x y`、`rawblock "id" {…}`（工具寫不出來的壞掉積木，原樣保留）。省略 `@id` 時會產生新的 id。

### 積木

一行一個積木：`opcode 參數…`。下一個積木寫在下一行（同樣縮排），C 積木裡的積木堆寫在 `SUBSTACK:`（或 `SUBSTACK2:` 等輸入名稱）下面一層。

| 寫法 | 意思 |
| --- | --- |
| `NAME=值` | 輸入 |
| `NAME:"值"` | 欄位（下拉選單等）。變數、清單、廣播欄位的 id 會依名稱找（先找角色自己的，再找舞台的）；不同時寫成 `NAME:"值"@"id"` 或 `@null` |
| `(opcode …)` | 放進輸入的積木 |
| `[opcode …]` | shadow 積木 |
| `10`、`"文字"` | 值。型別是那個輸入在積木區的 shadow 型別（數字、角度、顏色、文字…），不知道時數字是 `num`、文字是 `text` |
| `num(…)` `pos(…)` `whole(…)` `int(…)` `angle(…)` `color(…)` `text(…)` | 指定型別的值（sb3 的 4 ~ 10） |
| `broadcast("名稱")` `var("名稱")` `list("名稱")` | 廣播、舊的變數 / 清單；id 依名稱找（沒有的廣播會自動建立），或寫 `broadcast("名稱", "id")` |
| `menu("值")` | 選單的 shadow（例如 `COSTUME=menu("一般")`），選單積木由工具產生 |
| `none` | 空的輸入 |
| `(積木)`（沒有 `|`） | 放在有 shadow 型別的輸入時，底下自動加一個空的 shadow（跟編輯器一樣，拖走積木後還有空格） |
| `(積木)|值` | 積木蓋住的 shadow 不是空的時候 |
| `%1` `%2` `%3` 開頭 | 輸入類型跟上面推得的不同時才會出現 |
| `@id "…"`、`@mutation {…}`、`@comment {…}`、`@shadow`、`@parent`、`@extra {…}`、`@drop […]` | 其他資料；後四個只在原始專案有不尋常的結構時出現 |

自訂積木有簡寫，工具會產生 prototype、參數積木與 mutation：

```
  script 0 800
    define "spawn %s %b" "anywhere" "fast" @warp  # @warp：執行時不重新整理畫面
    motion_changeyby DY=(argument_reporter_string_number VALUE:"anywhere")
  script 0 0
    event_whenflagclicked
    call "spawn %s %b" anywhere=1 fast=(operator_gt OPERAND1=1 OPERAND2=0)
```

呼叫依參數名稱對應（要在同一個角色裡 `define`）；沒給的文字參數是空格。有回傳值的自訂積木（放在輸入裡）加 `@return "1"`。其他角色的積木（`呼叫 [角色] 的 [函式]`）靠 prototype 的 id，這時 `define` 會帶 `@protoid` / `@argids`。

## 驗證

`build`、`check` 和局部修改都會先驗證，錯誤指出是文字的第幾行：

- 未知的 opcode（附最接近的，例如「是不是 motion_movesteps？」）、積木沒有的輸入或欄位、固定選單的值不在選項裡。
- 造型、背景、音效、角色名稱不存在（警告）。
- 自訂積木找不到、參數 id 對不上、參數積木不在定義裡。
- 「讓 (i) 從 () 跑到 ()」迴圈：同名的迴圈放在同名迴圈裡、迴圈變數不在同名迴圈裡（警告）。編輯器只在拖曳放下時把內層改名成 j、k…，載入時不會改，所以文字要自己取不同名字。
- 只有讀取、沒有地方設定的全域變數 / 分身變數（警告，常是打錯字）。SVG 造型的綁定算讀取。
- SVG 造型綁定的錯誤（警告，指出造型和 SVG 的第幾行）：大括號沒關、沒有的函式、寫錯的運算式。
- 積木之間的連結（next / parent / 輸入指向不存在的積木）。
- 最後在 Node 的 VM 裡載入專案，並用編譯器編譯每個 script（自訂擴充不能在 Node 載入，會跳過並警告）。

## 局部修改

只改一個角色的一部分，其他積木（包括 id）原封不動，素材照樣保留：

```sh
node tools/3dsb-text.js replace-script 專案.3dsb --sprite 榴槤 --script 3 新的.txt   # 取代 script 3（位置和編號不變）
node tools/3dsb-text.js add-script 專案.3dsb --sprite 榴槤 新的.txt                  # 加在最下面（可以好幾個 script）
node tools/3dsb-text.js delete-script 專案.3dsb --sprite 榴槤 --script 3
node tools/3dsb-text.js insert 專案.3dsb --sprite 榴槤 --after 積木id 片段.txt        # id 用 dump --ids 看
```

片段是 `script x y` 開頭的 script，或只是幾行積木（`insert` 只能這樣）。沒有 `-o` 時覆寫原檔。`add-script` 也可以直接給 `.b3s`。

## 簡化語法（.b3s）

給人手寫，編譯成同一種文字格式（`compile`），所以驗證與轉回專案都一樣。不用中文積木文字當語法（顯示文字有歧義，也會改版）。

```
# 空白鍵跳一下
when flag {
  分數 = 0                      # 全域變數（資料）：twdata_set
  self.vy = 0                   # 分身變數：twclonevars_setVariable；local.x 是區域變數
  forever {
    if self.y <= 0 and sensing_keypressed(KEY_OPTION: "space") {
      self.vy = 8
      broadcast "jump"
    } else if self.state == "air" {
      self.vy -= 0.5
      motion3d_changeaxis(AXIS: "y", VALUE: self.vy / 10)
    }
    wait 0
  }
}

when receive "jump" {
  say(join("跳了 ", 分數) ++ " 次")
  for i in 1..3 {
    log(hypot(i, 4))
  }
}

when frame late {               # 當每幀 [更新後]；dt 是經過秒數
  鏡頭.距離 = clamp(鏡頭.距離 + dt, 2, 10)
}

define hypot(a, b) warp {       # 參數加 : bool 是真假值參數
  return sqrt(a * a + b * b)
}
```

- 事件：`when flag`、`clicked`、`stageclicked`、`key "space"`、`receive "訊息"`、`clone`（裡面的 `id` 是分身 id，用 `control_create_clone_of(CLONE_OPTION: "角色", ID: …)` 指定）、`frame` / `frame late`（`dt`），或任何 hat 的 opcode，例如 `when twmouse_whenwheel(DIRECTION: "UP") { }`。
- 指令：`if … { } else if … { } else { }`、`forever`、`repeat n`、`while 條件`、`until 條件`、`for i in 1..10`（`讓 i 從 1 跑到 10`；巢狀的迴圈要用不同名字）、`wait 秒`、`wait until 條件`、`broadcast "訊息" [and wait]`、`stop "all"`、`return 值`、`路徑 = 值`、`+=`、`-=`。
- 值：數字、`"文字"`、`true` / `false`、路徑（`分數`、`enemies[1].x`、`a["b.c"]`、`self.hp`、`local.i`；`[ ]` 裡只能是數字或文字）、`+ - * / %`、`++`（字串組合）、`== != < > <= >=`、`and or not`。
- 函式：`join random round length letter contains min max clamp lerp atan2 isclone say log`，數學 `abs floor ceil sqrt sin cos tan asin acos atan ln log10 exp pow10`，同一個檔案 `define` 的自訂積木，以及任何積木的 opcode：`opcode(值, …)` 依積木上的順序，或 `opcode(NAME: 值)`。欄位給文字，選單輸入給文字時會產生選單 shadow。後面接 `{ }`（和 `else { }`）是 C 積木裡的積木堆。
- 角色事件（公開介面）：`emit "被點到"`、`emit "值改變" 分數`（帶值）、`emit "確認" and wait`；接收用 `when 按鈕.被點到 { }`，裡面 `event_value()`、`triggered_sprite()`、`triggered_id()`。事件要寫在發出的角色的 `prop interface {"events":[{"name":"被點到"}],"public":[]}`（`public` 是公開的自訂積木的 prototype id），`check` 會找沒宣告的事件。`refs 被點到`（或 `refs 按鈕.被點到`）列出發出和接收的地方。
- 錯誤指出 `.b3s` 的行號；編譯出來的每一行後面有 `# b3s:行號`。
- 運算式的 parser 跟 SVG 綁定共用（`scratch-vm/src/util/b3-expression.js`）。`條件 ? 值 : 另一個值` 只能用在綁定。

## 元件

元件的定義在 `project.json` 的 `components`，文字裡寫成 `component "id"`（跟 sprite 一樣的寫法；`prop title` 是元件名稱，`prop props` 是屬性，`prop outputs` 是輸出，`prop interface` 是普通角色的事件，`prop members` 是元件裡的角色和子元件，其餘是元件的根本身：造型、變數、script）。實體是 `prop component "id"` 的 sprite，只有自己的值（位置、`prop props {"文字":"開始"}`、跟元件不同的變數），**不能有 script**（`check` 會報錯）。`refs`、`stats`、`check` 都會看元件裡的 script。`formatVersion` 5 起元件的資料不和舊版相容。

- **局部座標**：`prop members` 裡每個成員的 `x`、`y`、`direction`、`size` 是元件裡的座標（根是原點）；根（實體）的 `x`、`y`、`direction`、`size` 是整個元件在它那一層的擺放。成員的 script 裡 `motion_gotoxy` 等是元件內座標；「滑鼠 x / y」在元件裡也是元件內座標，舞台上的是 `twcomp_stageMouseX` / `twcomp_stageMouseY`。
- **根就是介面**：元件裡的 `global.` 是根的變數（成員的 `分數`、`global.分數` 和根的 `self.分數` 是同一份，每個實體各一份），不會讀專案的變數。屬性（`prop props`）就是根上開放給外面設定的變數：`.b3s` 直接寫 `文字`、`global.文字`，或 `prop.文字`（屬性積木，可以放進六角形的格子）；外面用 `getprop("開始按鈕", "文字")` 讀、`all_instances("按鈕")`；**外面不能直接寫**元件的屬性（`twcomp_setInstanceProp` 不會執行，`check` 報錯），要寫就呼叫元件的輸入。
- **輸入**是根的公開自訂積木（`prop interface` 的 `public`，外面用 `呼叫 [實體] 的 [函式]`）。從外面改元件的值、父元件控制子元件，都走輸入：輸入的 script 裡寫 `開 = 參數`。
- **輸出**：元件對外面說話。在元件上宣告 `prop outputs [{"id":"pressed","proccode":"被點擊 開啟 %b","params":[{"id":"on","name":"開啟","type":"b"}]}]`（`id` 和參數 `id` 是穩定的識別碼，文字和名稱可以隨時改）。元件裡用 `twcomp_emit on=(…) PORT:"pressed"`（`.b3s`：`emit out pressed(on: prop.開)`，並等待 `emit out pressed(on: 1) and wait`）；外面用 `twcomp_whenOutput SPRITE:"開始按鈕" PORT:"pressed" on=[twcomp_outputParam PORT:"pressed" PARAM:"on"]`（`.b3s`：`when out 開始按鈕.pressed (on) { }`，任一個實體 `when out any 按鈕.pressed (on) { }`，`on` 是參數，可以在下面的積木裡用）。輸出可以轉發：`prop outputs` 裡的輸出加 `"forward":{"instance":"搖樹","port":"pressed","map":{"自己的參數 id":"子元件的參數 id"}}`，子元件 `搖樹` 發出 `pressed` 時，這個元件自動發出它（編輯器裡在 `當 [搖樹] 發出 …` 上按右鍵「轉發成這個元件的輸出」）。輸出只送給元件那一層：專案聽得到專案裡的實體，元件裡聽得到元件裡的子元件。`check` 會找沒宣告的輸出和參數，`refs 按鈕.pressed` 列出發出和接收的地方。
- **啟動**：元件裡沒有綠旗；專案的綠旗和廣播不會進到元件裡（元件裡的廣播也不會出來）。元件出現（放一個實體、綠旗重設）時 `twcomp_whenCreated`（`.b3s`：`when created { }`）各跑一次；每幀用 `when frame { }`。
- 元件的頁面（編輯器裡進入元件）是一份不存檔的複本，專案不會動；輸出會列在「元件」分頁的紀錄裡。

## SVG 綁定

造型是檔案，不在 `project.json` 裡，所以 `dump` 只在角色開頭用註解列出（`# 造型「計數」綁定：掉落 {掉落數目} 個`）；`refs`、`check` 會讀專案（或 `assets`）裡的 SVG。語法：

- 文字裡的 `{運算式}`：`掉落 {掉落數目} 個`、`{分數:00000}`（補零）、`{時間:0.0}`（小數位數）、`{比例:0%}`（百分比）；`{{`、`}}` 是大括號本身。
- 任何屬性（SVG 程式碼模式）：`height="{min(燃料, 100) / 10}"`。不能綁 `href`、`on…`、`style`；值裡有 `url(` 時不用。
- `<g>` 上的 `data-bind-x / y`（位移）、`data-bind-rotate`（角度）、`data-bind-scale-x / y`（繞 `data-bind-origin="x y"` 縮放）、`data-bind-fill / stroke`（整組的顏色）、`data-bind-opacity`、`data-bind-visible`。
- 運算式：數字、`"文字"` 或 `'文字'`、`true` / `false`、路徑（`分數`、`self.hp`、`玩家.x`；元件裡的 `分數` 是元件自己的變數）、`+`（數字相加，其他接起來）、`++`、`- * / %`、比較、`and or not`、`條件 ? a : b`，函式 `min max clamp lerp abs round floor ceil sqrt sin cos atan2 length join`。
- 值改變時才重畫，每個造型每幀最多一次；分身的值跟主體不同時才另外建 skin。運算錯誤時文字是空的、屬性維持上一次的值。
