import fs from 'fs';
let text = fs.readFileSync('src/App.tsx', 'utf8');
let t1 = `                  );
                } catch (e) {}
              }
            }
          }
        }
      }`;

let t1_replace = `                  );
                } catch (e) {}
              }
            }
          }
        }`;

while(text.indexOf(t1) !== -1) {
    text = text.replace(t1, t1_replace);
}

fs.writeFileSync('src/App.tsx', text);
console.log('done!');
