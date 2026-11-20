//! `opensw-cli`: the same commands as the MCP tools (src/api.js), typed in a terminal or
//! run from a script, for computers where no AI app can be installed. Each command goes
//! to the running editor through its control channel, like `opensw --mcp` (mcp.rs).
//!
//!   opensw-cli help                  the commands
//!   opensw-cli help open             one command's arguments
//!   opensw-cli open --path C:\a.tex  a command; --name value for each argument
//!   opensw-cli compute --json "{...}" arguments as one JSON object
//!   opensw-cli compute --json-file a.json   the same, read from a file (UTF-8): nothing to quote
//!
//! Prints the result (text as it is, anything else as JSON); errors go to stderr.
//! Exit code: 0 done, 1 the command failed, 2 wrong use.

use serde_json::{Map, Value, json};

use crate::mcp;

pub fn run(args: &[String]) -> i32 {
    let tools: Vec<Value> = serde_json::from_str(mcp::TOOLS).unwrap_or_default();
    let Some(cmd) = args.first() else {
        print!("{}", help(&tools, None));
        return 0;
    };
    if cmd == "help" || cmd == "--help" || cmd == "-h" {
        return match help_for(&tools, args.get(1).map(String::as_str)) {
            Ok(s) => { print!("{s}"); 0 }
            Err(e) => { eprintln!("{e}"); 2 }
        };
    }
    let call = match parse(&tools, cmd, &args[1..]) {
        Ok(c) => c,
        Err(e) => { eprintln!("{e}"); return 2; }
    };
    match mcp::send(cmd, &call) {
        Ok(reply) if reply["ok"].as_bool() == Some(true) => {
            match &reply["result"] {
                Value::String(s) => println!("{s}"),
                Value::Null => {}
                v => println!("{}", serde_json::to_string_pretty(v).unwrap_or_default()),
            }
            0
        }
        Ok(reply) => { eprintln!("error: {}", reply["error"].as_str().unwrap_or("failed")); 1 }
        Err(e) => { eprintln!("error: {e}"); 1 }
    }
}

fn tool<'a>(tools: &'a [Value], cmd: &str) -> Option<&'a Value> {
    tools.iter().find(|t| t["name"].as_str().and_then(|n| n.strip_prefix(mcp::PREFIX)) == Some(cmd))
}

fn help_for(tools: &[Value], cmd: Option<&str>) -> Result<String, String> {
    match cmd {
        None => Ok(help(tools, None)),
        Some(c) => tool(tools, c).map(|t| help(tools, Some(t))).ok_or_else(|| format!("Unknown command {c}; opensw-cli help lists them")),
    }
}

fn help(tools: &[Value], one: Option<&Value>) -> String {
    let mut s = String::new();
    if let Some(t) = one {
        let name = t["name"].as_str().unwrap_or("").trim_start_matches(mcp::PREFIX);
        s += &format!("opensw-cli {name}");
        let required: Vec<&str> = t["inputSchema"]["required"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        if let Some(props) = t["inputSchema"]["properties"].as_object() {
            for (k, v) in props {
                let ty = v["type"].as_str().unwrap_or("");
                s += &if required.contains(&k.as_str()) { format!(" --{k} <{ty}>") } else { format!(" [--{k} <{ty}>]") };
            }
        }
        s += &format!("\n\n{}\n", t["description"].as_str().unwrap_or(""));
        return s;
    }
    s += "opensw-cli <command> [--argument value ...]   (or --json \"{...}\", or --json-file file.json)\n\nCommands:\n";
    for t in tools {
        let name = t["name"].as_str().unwrap_or("").trim_start_matches(mcp::PREFIX);
        let first = t["description"].as_str().unwrap_or("").split(". ").next().unwrap_or("");
        s += &format!("  {name:<14} {first}\n");
    }
    s += "\nopensw-cli help <command> shows its arguments. The editor opens when it is not running.\n";
    s
}

/// The arguments after the command -> the JSON object the command takes. Each value is
/// read as the type the command gives for it (a string stays a string).
fn parse(tools: &[Value], cmd: &str, rest: &[String]) -> Result<Value, String> {
    let t = tool(tools, cmd).ok_or_else(|| format!("Unknown command {cmd}; opensw-cli help lists them"))?;
    let props = t["inputSchema"]["properties"].as_object().cloned().unwrap_or_default();
    let mut out = Map::new();
    let mut i = 0;
    while i < rest.len() {
        let key = rest[i].strip_prefix("--").ok_or_else(|| format!("Expected --argument, got {}", rest[i]))?;
        let val = rest.get(i + 1).ok_or_else(|| format!("--{key} needs a value"))?;
        if key == "json" {
            match serde_json::from_str::<Value>(val) {
                Ok(Value::Object(m)) => out.extend(m),
                _ => return Err("--json needs a JSON object".to_string()),
            }
        } else if key == "json-file" {
            // a formula has backslashes, quotes and braces, which every shell treats its own way
            let text = std::fs::read_to_string(val).map_err(|e| format!("Cannot read {val}: {e}"))?;
            match serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) {
                Ok(Value::Object(m)) => out.extend(m),
                _ => return Err(format!("{val} does not hold a JSON object")),
            }
        } else {
            let ty = props.get(key).ok_or_else(|| format!("{cmd} has no argument --{key}; opensw-cli help {cmd}"))?["type"].as_str().unwrap_or("");
            out.insert(key.to_string(), value(ty, val).map_err(|e| format!("--{key}: {e}"))?);
        }
        i += 2;
    }
    if let Some(req) = t["inputSchema"]["required"].as_array() {
        for k in req.iter().filter_map(Value::as_str) {
            if !out.contains_key(k) {
                return Err(format!("{cmd} needs --{k}; opensw-cli help {cmd}"));
            }
        }
    }
    Ok(Value::Object(out))
}

fn value(ty: &str, s: &str) -> Result<Value, String> {
    match ty {
        "string" => Ok(json!(s)),
        "integer" => s.parse::<i64>().map(|n| json!(n)).map_err(|_| format!("{s} is not a whole number")),
        "number" => s.parse::<f64>().map(|n| json!(n)).map_err(|_| format!("{s} is not a number")),
        "boolean" => match s { "true" => Ok(json!(true)), "false" => Ok(json!(false)), _ => Err("true or false".to_string()) },
        // an array: JSON (["x","y"]), or words separated by commas
        "array" => serde_json::from_str::<Value>(s).ok().filter(Value::is_array)
            .map_or_else(|| Ok(json!(s.split(',').map(str::trim).filter(|x| !x.is_empty()).collect::<Vec<_>>())), Ok),
        _ => Ok(serde_json::from_str(s).unwrap_or_else(|_| json!(s))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools() -> Vec<Value> { serde_json::from_str(mcp::TOOLS).unwrap() }
    fn args(a: &[&str]) -> Vec<String> { a.iter().map(|s| s.to_string()).collect() }

    #[test]
    fn arguments_should_take_the_command_types() {
        let v = parse(&tools(), "insert", &args(&["--latex", "x^2", "--index", "3"])).unwrap();
        assert_eq!(v, json!({ "latex": "x^2", "index": 3 }));
    }

    #[test]
    fn a_number_for_a_string_argument_should_stay_a_string() {
        let v = parse(&tools(), "find", &args(&["--text", "10"])).unwrap();
        assert_eq!(v["text"], json!("10"));
    }

    #[test]
    fn json_should_give_all_arguments() {
        let v = parse(&tools(), "compute", &args(&["--json", r#"{"op":"evaluate","latex":"1+1"}"#])).unwrap();
        assert_eq!(v["op"], "evaluate");
    }

    #[test]
    fn json_file_should_give_all_arguments_from_a_file_with_or_without_a_byte_order_mark() {
        let file = std::env::temp_dir().join(format!("opensw-cli-test-{}.json", std::process::id()));
        for mark in ["", "\u{feff}"] {
            std::fs::write(&file, format!(r#"{mark}{{"op":"simplify","latex":"\\frac{{x^{{2}}}}{{x}}"}}"#)).unwrap();
            let v = parse(&tools(), "compute", &args(&["--json-file", file.to_str().unwrap()])).unwrap();
            assert_eq!(v, json!({ "op": "simplify", "latex": "\\frac{x^{2}}{x}" }));
        }
        std::fs::remove_file(&file).unwrap();
        assert!(parse(&tools(), "compute", &args(&["--json-file", file.to_str().unwrap()])).is_err());
    }

    #[test]
    fn unknown_commands_and_arguments_should_be_refused() {
        assert!(parse(&tools(), "nope", &[]).is_err());
        assert!(parse(&tools(), "open", &args(&["--nope", "1"])).is_err());
        assert!(parse(&tools(), "open", &args(&["--path"])).is_err());
    }

    #[test]
    fn help_should_list_every_command() {
        let h = help(&tools(), None);
        for t in tools() { assert!(h.contains(t["name"].as_str().unwrap().trim_start_matches(mcp::PREFIX))); }
    }

    #[test]
    fn help_for_a_command_should_show_its_arguments() {
        let h = help_for(&tools(), Some("open")).unwrap();
        assert!(h.contains("--path"));
    }
}
